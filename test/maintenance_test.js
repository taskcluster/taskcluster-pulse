suite('Namespace', () => {
  let _ = require('lodash');
  let assert = require('assert');
  let taskcluster = require('taskcluster-client');
  let testing = require('taskcluster-lib-testing');
  let helper = require('./helper');
  let load = require('../lib/main');
  let slugid = require('slugid');
  let maintenance = require('../lib/maintenance');
  let Debug = require('debug');
  let amqp = require('amqplib');
  let sinon = require('sinon');

  let debug = Debug('maintenance-test');
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

  suite('monitoring queues', async () => {

    if (!helper.haveRabbitMq) {
      this.pending = true;
    }

    let connection, channel, exchangeName, queueName;

    let fillQueue = async (number) => {
      debug('adding ' + number + ' messages to the testing queue');
      _.times(number, () => channel.publish(exchangeName, 'bar', new Buffer('baz')));
      let baseline = (await helper.rabbit.queue(queueName)).messages;
      await testing.poll(async () => {
        debug('filling monitor testing queue');
        let res = await helper.rabbit.queue(queueName);
        assert.equal(res.messages, baseline + number);
      }, 64);
    };

    setup(async () => {
      exchangeName = 'exchange/tcpulse-test-m/foo';
      queueName = 'queue/tcpulse-test-m/bar';
      let ns = await helper.pulse.claimNamespace('tcpulse-test-m', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
      connection = await amqp.connect(ns.connectionString);
      channel = await connection.createChannel();
      await channel.assertExchange(exchangeName, 'topic');
    });

    teardown(async () => {
      await connection.close();
    });

    test('basic', async () => {

      // Set up a queue that shouldn't be managed by the service
      let safeQueueName = 'beeblebrox';
      await helper.rabbit.createQueue(safeQueueName);
      if ((await helper.rabbit.queue(safeQueueName)).messages < 50) {
        _.times(50, () => helper.write(safeQueueName, 'baz'));
        await testing.poll(async () => {
          debug('filling monitor testing safe queue');
          let res = await helper.rabbit.queue(safeQueueName);
          assert.equal(res.messages, 0);
        }, 64);
      }

      // Now set up the queue that should be managed
      await channel.assertQueue(queueName);
      await channel.purgeQueue(queueName);
      await testing.poll(async () => {
        debug('clearing monitor testing queue');
        let res = await helper.rabbit.queue(queueName);
        assert.equal(res.messages, 0);
      }, 64);
      await channel.bindQueue(queueName, exchangeName, '#');

      let notify = {
        email: sinon.spy(),
      };

      let monitorIteration = async () => {
        await maintenance.monitor({
          cfg: helper.cfg,
          manager: helper.rabbit,
          Namespace: helper.Namespace,
          RabbitQueue: helper.RabbitQueue,
          notify,
        });
      };

      debug('On empty queue, we should not alert');
      await monitorIteration();
      assert.equal(notify.email.callCount, 0);
      await helper.rabbit.queue(queueName);

      debug('Below alert threshold, we should not alert');
      await fillQueue(3);
      await monitorIteration();
      assert.equal(notify.email.callCount, 0);
      await helper.rabbit.queue(queueName);

      debug('Above alert threshold, we should alert');
      await fillQueue(3);
      await monitorIteration();
      assert.equal(notify.email.callCount, 1);
      await helper.rabbit.queue(queueName);

      debug('Above delete threshold, we should delete');
      await fillQueue(10);
      await monitorIteration();
      return await helper.rabbit.queue(queueName).then(() => {
        assert(false, 'This queue should have been deleted!');
      }).catch(async err => {
        assert(err.statusCode === 404, 'Queue should not be found');
        assert(notify.email.callCount, 2);
        await helper.rabbit.queue(safeQueueName); // This should not have been deleted
      });
    });
  });

  suite('monitoring other', async () => {
    test('connections', async () => {
      // ensure there's a connection we shouldn't mess with
      let unmanagedConnection = await amqp.connect(helper.cfg.app.amqpUrl);

      // setup a connection we _should_ kill
      let ns2 = await helper.pulse.claimNamespace('tcpulse-test-m2', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
      let dyingConnection = await amqp.connect(ns2.connectionString);

      // To get us over the kill threshold
      await testing.sleep(2000);

      // setup a connection we _should not_ kill
      let ns1 = await helper.pulse.claimNamespace('tcpulse-test-m1', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
      let managedConnection = await amqp.connect(ns1.connectionString);

      let connectedUsers = _.map(await helper.rabbit.connections(), 'user');
      assert(_.includes(connectedUsers, 'guest'));
      assert(_.includes(connectedUsers, 'tcpulse-test-m1-1'));
      assert(_.includes(connectedUsers, 'tcpulse-test-m2-1'));

      await maintenance.monitor({
        cfg: _.defaults({monitor: {connectionMaxLifetime: '-1 seconds'}}, helper.cfg),
        manager: helper.rabbit,
        Namespace: helper.Namespace,
        RabbitQueue: helper.RabbitQueue,
        notify: {email: sinon.spy()},
      });

      connectedUsers = _.map(await helper.rabbit.connections(), 'user');
      assert(_.includes(connectedUsers, 'guest'));
      assert(_.includes(connectedUsers, 'tcpulse-test-m1-1'));
      assert(!_.includes(connectedUsers, 'tcpulse-test-m2-1'));
    });

    test('exchanges', async () => {
      let exchangeName = 'exchange/tcpulse-test-n/bar';
      let ns = await helper.pulse.claimNamespace('tcpulse-test-n', {
        expires: taskcluster.fromNow('-1 day'),
        contact: 'a@a.com',
      });
      let connection = await amqp.connect(ns.connectionString);
      let channel = await connection.createChannel();
      await channel.assertExchange(exchangeName, 'topic');

      let exchanges = _.map(await helper.rabbit.exchanges(), 'name');
      assert(_.includes(exchanges, exchangeName));

      await maintenance.expire({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg: helper.cfg,
        rabbitManager: helper.rabbit,
      });
      await maintenance.monitor({
        cfg: helper.cfg,
        manager: helper.rabbit,
        Namespace: helper.Namespace,
        RabbitQueue: helper.RabbitQueue,
        notify: {email: sinon.spy()},
      });

      exchanges = _.map(await helper.rabbit.exchanges(), 'name');
      assert(!_.includes(exchanges, exchangeName));
    });
  });
});

