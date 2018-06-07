const _ = require('lodash');
const assert = require('assert');
const taskcluster = require('taskcluster-client');
const testing = require('taskcluster-lib-testing');
const helper = require('./helper');
const load = require('../src/main');
const slugid = require('slugid');
const maintenance = require('../src/maintenance');
const Debug = require('debug');
const amqp = require('amqplib');
const sinon = require('sinon');

const debug = Debug('maintenance-test');

helper.secrets.mockSuite('Maintenance', ['taskcluster'], function(mock, skipping) {
  helper.withRabbitMq(mock, skipping);
  helper.withEntities(mock, skipping);
  helper.withServer(mock, skipping);

  let shouldFail = async fn => {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    throw new Error('did not fail');
  };

  // setup some useful values..
  let cfg, rabbitManager;
  suiteSetup('set cfg and rabbit', async function() {
    cfg = await helper.load('cfg');
    rabbitManager = await helper.load('rabbitManager');
  });

  // note that claim is adequately tested via api_test.js

  suite('expire namespace', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    test('expire namespace - no entries', async () => {
      await maintenance.expire({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });

      let count = 0;
      await helper.Namespace.scan({}, {handler: (ns) => count++});
      assert(count===0);
    });

    test('expire namespace - two entries', async () => {
      await maintenance.claim({
        Namespace: helper.Namespace,
        rabbitManager,
        cfg,
        namespace: 'e1',
        contact: 'a@b.c',
        expires: taskcluster.fromNow('-1 day'),
      });

      await maintenance.claim({
        Namespace: helper.Namespace,
        rabbitManager,
        cfg,
        namespace: 'e2',
        contact: 'a@b.c',
        expires: taskcluster.fromNow('11 day'),
      });

      await maintenance.expire({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });

      let remaining = [];
      await helper.Namespace.scan({}, {handler: (ns) => remaining.push(ns.namespace)});

      assert.deepEqual(remaining, ['e2']);
    });
  });

  suite('rotate namespace', function() {
    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    test('rotate namespace - no entries', async () => {
      await maintenance.rotate({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });

      let count = 0;
      await helper.Namespace.scan({},
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

      await helper.Namespace.create({
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
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });

      var ns = await helper.Namespace.load({namespace: 'tcpulse-test-sample'});
      assert(ns, 'namespace should exist');
      assert(ns.rotationState==='2', 'namespace should have rotated state');
      assert(ns.password !== old_pass, 'rotated namespace should have new password');

    });

    test('rotate namespace - two entry', async () => {
      var old_pass = slugid.v4();

      await helper.Namespace.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      await helper.Namespace.create({
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
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });

      var ns1 = await helper.Namespace.load({namespace: 'tcpulse-test-sample1'});
      var ns2 = await helper.Namespace.load({namespace: 'tcpulse-test-sample2'});

      assert(ns1 && ns2, 'namespaces should exist');
      assert(ns1.rotationState==='2', 'tcpulse-test-sample1 should have rotated state');
      assert(ns1.password !== old_pass, 'rotated tcpulse-test-sample1 should have new password');

      assert(ns2.rotationState==='1', 'tcpulse-test-sample2 should have rotated state');
      assert(ns2.password !== old_pass, 'rotated tcpulse-test-sample2 should have new password');

    });

    test('rotate namespace - one of two entry', async () => {
      var old_pass = slugid.v4();

      await helper.Namespace.create({
        namespace: 'tcpulse-test-sample1',
        username: 'tcpulse-test-sample',
        password: old_pass,
        created:  new Date(),
        expires:  taskcluster.fromNow('1 hour'),
        rotationState: '1',
        nextRotation:  taskcluster.fromNow('- 1 day'),
        contact: 'a@b.c',
      });

      await helper.Namespace.create({
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
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });

      var ns1 = await helper.Namespace.load({namespace: 'tcpulse-test-sample1'});
      var ns2 = await helper.Namespace.load({namespace: 'tcpulse-test-sample2'});

      assert(ns1 && ns2, 'namespaces should exist');
      assert(ns1.rotationState==='2', 'tcpulse-test-sample1 should have rotated state');
      assert(ns1.password !== old_pass, 'rotated tcpulse-test-sample1 should have new password');

      assert(ns2.rotationState ==='2', 'tcpulse-test-sample2 should have same rotation state');
      assert(ns2.password === old_pass, 'tcpulse-test-sample2 should have same password');
    });

    test('rotate namespace - multiple rotations', async () => {
      var old_pass = slugid.v4();

      await helper.Namespace.create({
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
        var ns1 = await helper.Namespace.load({namespace: 'tcpulse-test-sample1'});
        assert(ns1, 'namespaces should exist');
        assert(ns1.rotationState === state, 'tcpulse-test-sample1 should have rotated state');
      };

      await maintenance.rotate({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 days'),
        cfg,
        rabbitManager,
      });
      await assertRotationState('2');
      await maintenance.rotate({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('1 day'),
        cfg,
        rabbitManager,
      });
      await assertRotationState('1');
      await maintenance.rotate({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('2 days'),
        cfg,
        rabbitManager,
      });
      await assertRotationState('2');
    });
  });

  suite('monitoring queues (long tests)', async () => {
    helper.withAmqpChannels(mock, skipping);

    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    let channel;
    const exchangeName = 'exchange/tcpulse-test-m/foo';
    const queueName = 'queue/tcpulse-test-m/bar';

    let fillQueue = async (number) => {
      debug('adding ' + number + ' messages to the testing queue');
      _.times(number, () => channel.publish(exchangeName, 'bar', new Buffer('baz')));
      let baseline = (await rabbitManager.queue(queueName)).messages;
      await testing.poll(async () => {
        debug('filling monitor testing queue');
        let res = await rabbitManager.queue(queueName);
        assert.equal(res.messages, baseline + number);
      }, 64);
    };

    setup(async () => {
      let ns = await helper.client().claimNamespace('tcpulse-test-m', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
      channel = await helper.channel();
      await channel.assertExchange(exchangeName, 'topic');
    });

    test('basic', async () => {
      // Set up a queue that shouldn't be managed by the service
      let safeQueueName = 'beeblebrox';
      await rabbitManager.createQueue(safeQueueName);
      if ((await rabbitManager.queue(safeQueueName)).messages < 50) {
        debug('filling monitor testing safe queue');
        const msg = Buffer.from('baz');
        const channel = await helper.channel();
        _.times(50, () => channel.sendToQueue(safeQueueName, msg));
        debug('waiting for messages to arrive');
        await testing.poll(async () => {
          let res = await rabbitManager.queue(safeQueueName);
          assert.equal(res.messages, 50);
        }, 64);
      }

      // Now set up the queue that should be managed
      await channel.assertQueue(queueName);
      await channel.purgeQueue(queueName);
      await testing.poll(async () => {
        debug('clearing monitor testing queue');
        let res = await rabbitManager.queue(queueName);
        assert.equal(res.messages, 0);
      }, 64);
      await channel.bindQueue(queueName, exchangeName, '#');

      let notify = {
        email: sinon.spy(),
      };

      let monitorIteration = async () => {
        await maintenance.monitor({
          cfg,
          manager: rabbitManager,
          Namespace: helper.Namespace,
          RabbitQueue: helper.RabbitQueue,
          notify,
        });
      };

      debug('On empty queue, we should not alert');
      await monitorIteration();
      assert.equal(notify.email.callCount, 0);
      await rabbitManager.queue(queueName);

      debug('Below alert threshold, we should not alert');
      await fillQueue(3);
      await monitorIteration();
      assert.equal(notify.email.callCount, 0);
      await rabbitManager.queue(queueName);

      debug('Above alert threshold, we should alert');
      await fillQueue(3);
      await monitorIteration();
      assert.equal(notify.email.callCount, 1);
      await rabbitManager.queue(queueName);

      debug('Above delete threshold, we should delete');
      await fillQueue(10);
      await monitorIteration();
      return await rabbitManager.queue(queueName).then(() => {
        assert(false, 'This queue should have been deleted!');
      }).catch(async err => {
        assert(err.statusCode === 404, 'Queue should not be found');
        assert(notify.email.callCount, 2);
        await rabbitManager.queue(safeQueueName); // This should not have been deleted
      });
    });
  });

  suite('monitoring other (long tests)', async () => {
    helper.withAmqpChannels(mock, skipping);

    suiteSetup(function() {
      if (skipping()) {
        this.skip();
      }
    });

    test('connections', async () => {
      // ensure there's a connection we shouldn't mess with
      let unmanaged = await helper.channel();
      let managedConnection;

      // setup a connection we should kill due to being too old
      let ns2 = await helper.client().claimNamespace('tcpulse-test-m2', {
        expires: taskcluster.fromNow('1 day'),
        contact: 'a@a.com',
      });
      let dyingConnection2 = await amqp.connect(ns2.connectionString);
      let dyingConnection3;

      try {
        // To get us over the kill threshold. This is inherently somewhat
        // flaky, since it is using timing in tests, but unfortunately this
        // relies on times recorded by rabbitmq itself.
        await testing.sleep(5000);

        // setup a connection we should kill due to being expired
        let ns3 = await helper.client().claimNamespace('tcpulse-test-m3', {
          expires: taskcluster.fromNow('-1 day'),
          contact: 'a@a.com',
        });
        dyingConnection3 = await amqp.connect(ns3.connectionString);

        // setup a connection we _should not_ kill
        let ns1 = await helper.client().claimNamespace('tcpulse-test-m1', {
          expires: taskcluster.fromNow('1 day'),
          contact: 'a@a.com',
        });
        managedConnection = await amqp.connect(ns1.connectionString);

        await testing.poll(async () => {
          let connectedUsers = _.map(await rabbitManager.connections(), 'user');
          assert(_.includes(connectedUsers, 'guest'));
          assert(_.includes(connectedUsers, 'tcpulse-test-m1-1'));
          assert(_.includes(connectedUsers, 'tcpulse-test-m2-1'));
          assert(_.includes(connectedUsers, 'tcpulse-test-m3-1'));
        });

        await maintenance.expire({
          cfg,
          rabbitManager,
          Namespace: helper.Namespace,
          now: new Date(),
        });

        await maintenance.monitor({
          cfg: _.defaults({monitor: {connectionMaxLifetime: '-5 seconds'}}, cfg),
          manager: rabbitManager,
          Namespace: helper.Namespace,
          RabbitQueue: helper.RabbitQueue,
          notify: {email: sinon.spy()},
        });

        await testing.poll(async () => {
          let connectedUsers = _.map(await rabbitManager.connections(), 'user');
          assert(_.includes(connectedUsers, 'guest'));
          assert(_.includes(connectedUsers, 'tcpulse-test-m1-1'));
          assert(!_.includes(connectedUsers, 'tcpulse-test-m2-1')); // killed
          assert(!_.includes(connectedUsers, 'tcpulse-test-m3-1')); // killed
        });
      } finally {
        for (let dyingConn of [dyingConnection2, dyingConnection3]) {
          try {
            await dyingConn.close();
          } catch (err) {
            // expected error..
            if (!err.toString().match(/CONNECTION_FORCED/)) {
              throw err;
            }
          }
        }
        await managedConnection.close();
      }
    });

    test('exchanges', async () => {
      let exchangeName = 'exchange/tcpulse-test-n/bar';
      let ns = await helper.client().claimNamespace('tcpulse-test-n', {
        expires: taskcluster.fromNow('-1 day'),
        contact: 'a@a.com',
      });
      let channel = await helper.channel();
      await channel.assertExchange(exchangeName, 'topic');

      let exchanges = _.map(await rabbitManager.exchanges(), 'name');
      assert(_.includes(exchanges, exchangeName));

      await maintenance.expire({
        Namespace: helper.Namespace,
        now: taskcluster.fromNow('0 hours'),
        cfg,
        rabbitManager,
      });
      await maintenance.monitor({
        cfg,
        manager: rabbitManager,
        Namespace: helper.Namespace,
        RabbitQueue: helper.RabbitQueue,
        notify: {email: sinon.spy()},
      });

      exchanges = _.map(await rabbitManager.exchanges(), 'name');
      assert(!_.includes(exchanges, exchangeName));
    });
  });
});

