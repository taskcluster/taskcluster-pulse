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

  suite('expire namespace', function() {
    test('expire namespace - no entries', async () => {
      await maintenance.expire({Namespace, now: taskcluster.fromNow('0 hours')});

      let count = 0;
      await Namespace.scan({},
        {
          limit:            250,
          handler:          (ns) => {
            count++;
          },
        });

      assert(count===0, 'expired namespace not removed');
    });

    test('expire namespace - one entry', async () => {
      await Namespace.create({
        namespace: 'e1',
        username: slugid.v4(),
        password: slugid.v4(),
        created:  new Date(),
        expires:  taskcluster.fromNow('- 1 day'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await maintenance.expire({Namespace, now: taskcluster.fromNow('0 hours')});

      let count = 0;
      await Namespace.scan({},
        {
          limit:            250, // max number of concurrent delete operations
          handler:          (ns) => {
            count++;
          },
        });

      assert(count===0, 'expired namespace not removed');
    });

    test('expire namespace - two entries', async () => {
      await Namespace.create({
        namespace: 'e1',
        username: slugid.v4(),
        password: slugid.v4(),
        created:  new Date(),
        expires:  taskcluster.fromNow('- 1 day'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await Namespace.create({
        namespace: 'e2',
        username: slugid.v4(),
        password: slugid.v4(),
        created:  new Date(),
        expires:  taskcluster.fromNow('- 1 day'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await maintenance.expire({Namespace, now: taskcluster.fromNow('0 hours')});

      let count = 0;
      await Namespace.scan({},
        {
          limit:            250, // max number of concurrent delete operations
          handler:          (ns) => {
            count++;
          },
        });

      assert(count===0, 'expired namespaces not removed');
    });

    test('expire namespace - one of two entries', async () => {
      await Namespace.create({
        namespace: 'e1',
        username: slugid.v4(),
        password: slugid.v4(),
        created:  new Date(),
        expires:  taskcluster.fromNow('- 1 day'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await Namespace.create({
        namespace: 'e2',
        username: slugid.v4(),
        password: slugid.v4(),
        created:  new Date(),
        expires:  taskcluster.fromNow('1 day'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
      });

      await maintenance.expire({Namespace, now: taskcluster.fromNow('0 hours')});

      let count = 0;
      let name = '';
      await Namespace.scan({},
        {
          limit:            250, // max number of concurrent delete operations
          handler:          (ns) => {
            name=ns.namespace;
            count++;
          },
        });

      assert(count===1, 'one namespace should still be active');
      assert(name==='e2', 'wrong namespace removed');
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
        contact:  {},
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
        contact:  {},
      });

      await Namespace.create({
        namespace: 'tcpulse-test-sample2',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '2',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact:  {},
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
        contact:  {},
      });

      await Namespace.create({
        namespace: 'tcpulse-test-sample2',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '2',
        nextRotation:  taskcluster.fromNow('1 day'),
        contact:  {},
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
        contact:  {},
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

