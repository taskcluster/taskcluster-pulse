suite('Namespace', () => {
  let assert = require('assert');
  let taskcluster = require('taskcluster-client');
  let helper = require('./helper');
  let load = require('../lib/main');
  let slugid = require('slugid');
  let maintenance = require('../lib/maintenance');

  let Namespace;

  setup(async () => {
    //set up the namespace entities
    Namespace = await load('Namespace', {profile: 'test', process: 'test'});

    //ensureTable actually instantiates the table if non-existing. Supposed to be idempotent, but not
    await Namespace.ensureTable();
  });

  teardown(async () => {
    //remove the namespace entities
    await Namespace.removeTable();
  });

  let shouldFail = async fn => {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    throw new Error('did not fail');
  };

  // note that claim is adequately tested via api_test.js

  suite('delete namespace', function() {
    test('delete namespace - namespace with queues and exchanges', async () => {
      let ns = await maintenance.claim({
        Namespace,
        rabbitManager: helper.rabbit,
        cfg: helper.cfg,
        namespace: 'bar',
        contact: 'a@b.c',
        expires: taskcluster.fromNow('1 hours'),
      });

      let username = ns.username();
      await helper.rabbit.user(username); // check that user exists

      await helper.rabbit.createQueue('queue/notbar/abc');
      await helper.rabbit.createQueue('queue/bar/abc');
      await helper.rabbit.createQueue('queue/bar/def');
      await helper.rabbit.createExchange('exchange/notbar/events');
      await helper.rabbit.createExchange('exchange/bar/events');

      await maintenance.delete({
        Namespace,
        rabbitManager: helper.rabbit,
        cfg: helper.cfg,
        namespace: 'bar',
      });

      // make sure everything's gone
      await shouldFail(() => helper.rabbit.user(username));
      await helper.rabbit.queue('queue/notbar/abc'); // not deleted!
      await shouldFail(() => helper.rabbit.queue('queue/bar/abc'));
      await shouldFail(() => helper.rabbit.queue('queue/bar/def'));
      await helper.rabbit.exchange('exchange/notbar/events'); // not deleted!
      await shouldFail(() => helper.rabbit.exchange('exchange/bar/events'));

      ns = await Namespace.load({namespace: 'bar'}, true);
      assert.equal(ns, undefined);

      helper.rabbit.deleteQueue('queue/notbar/abc');
      helper.rabbit.deleteExchange('exchange/notbar/events');
    });
  });

  suite('expire namespace', function() {
    test('expire namespace - no entries', async () => {
      await maintenance.expire({
        Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });

      let count = 0;
      await Namespace.scan({}, {handler: (ns) => count++});
      assert(count===0);
    });

    test('expire namespace - two entries', async () => {
      await maintenance.claim({
        Namespace,
        rabbitManager: helper.rabbit,
        cfg: helper.cfg,
        namespace: 'e1',
        contact: 'a@b.c',
        expires: taskcluster.fromNow('-1 day'),
      });

      await maintenance.claim({
        Namespace,
        rabbitManager: helper.rabbit,
        cfg: helper.cfg,
        namespace: 'e2',
        contact: 'a@b.c',
        expires: taskcluster.fromNow('11 day'),
      });

      await maintenance.expire({
        Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });

      let remaining = [];
      await Namespace.scan({}, {handler: (ns) => remaining.push(ns.namespace)});

      assert.deepEqual(remaining, ['e2']);
    });
  });

  suite('rotate namespace', function() {
    if (!helper.haveRabbitMq) {
      this.pending = true;
    }

    test('rotate namespace - no entries', async () => {
      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });

      let count = 0;
      await Namespace.scan({},
        {
          limit:            250,
          handler:          (ns) => {
            count++;
          },
        });

      assert(count===0, 'no entries should exist');
    });

    test('rotate namespace - one entry', async () => {
      var old_pass = slugid.v4();

      await Namespace.create({
        namespace: 'tcpulse-test-sample',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });

      var ns = await Namespace.load({namespace: 'tcpulse-test-sample'});
      assert(ns, 'namespace should exist');
      assert(ns.rotationState==='2', 'namespace should have rotated state');
      assert(ns.password !== old_pass, 'rotated namespace should have new password');

    });

    test('rotate namespace - two entry', async () => {
      var old_pass = slugid.v4();

      await Namespace.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      await Namespace.create({
        namespace: 'tcpulse-test-sample2',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '2',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });

      var ns1 = await Namespace.load({namespace: 'tcpulse-test-sample1'});
      var ns2 = await Namespace.load({namespace: 'tcpulse-test-sample2'});

      assert(ns1 && ns2, 'namespaces should exist');
      assert(ns1.rotationState==='2', 'tcpulse-test-sample1 should have rotated state');
      assert(ns1.password !== old_pass, 'rotated tcpulse-test-sample1 should have new password');

      assert(ns2.rotationState==='1', 'tcpulse-test-sample2 should have rotated state');
      assert(ns2.password !== old_pass, 'rotated tcpulse-test-sample2 should have new password');

    });

    test('rotate namespace - one of two entry', async () => {
      var old_pass = slugid.v4();

      await Namespace.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      await Namespace.create({
        namespace: 'tcpulse-test-sample2',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '2',
        nextRotation:  taskcluster.fromNow('1 day'),
        contact: 'a@b.c',
      });

      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });

      var ns1 = await Namespace.load({namespace: 'tcpulse-test-sample1'});
      var ns2 = await Namespace.load({namespace: 'tcpulse-test-sample2'});

      assert(ns1 && ns2, 'namespaces should exist');
      assert(ns1.rotationState==='2', 'tcpulse-test-sample1 should have rotated state');
      assert(ns1.password !== old_pass, 'rotated tcpulse-test-sample1 should have new password');

      assert(ns2.rotationState ==='2', 'tcpulse-test-sample2 should have same rotation state');
      assert(ns2.password === old_pass, 'tcpulse-test-sample2 should have same password');
    });

    test('rotate namespace - multiple rotations', async () => {
      var old_pass = slugid.v4();

      await Namespace.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      var assertRotationState = async (state) => {
        var ns1 = await Namespace.load({namespace: 'tcpulse-test-sample1'});
        assert(ns1, 'namespaces should exist');
        assert(ns1.rotationState === state, 'tcpulse-test-sample1 should have rotated state');
      };

      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('0 days'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });
      await assertRotationState('2');
      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('1 day'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });
      await assertRotationState('1');
      await maintenance.rotate({
        Namespace,
        now: taskcluster.fromNow('2 days'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });
      await assertRotationState('2');
    });
  });
});

