suite('Rabbit Monitor', () => {
  const assert = require('assert');
  const sinon = require('sinon');
  const _ = require('lodash');
  const helper = require('./helper');
  const load = require('../lib/main');
  const RabbitMonitor = require('../lib/rabbitmonitor');

  const namespaceOne = 'one';
  const namespaceTwo = 'two';
  const taskClusterQueueOne = 'taskcluster/one';
  const taskClusterQueueTwo = 'taskcluster/two';

  setup(async () => {
    await helper.rabbit.createQueue(namespaceOne);
    await helper.rabbit.createQueue(namespaceTwo);
    await helper.rabbit.createQueue(taskClusterQueueOne);
    await helper.rabbit.createQueue(taskClusterQueueTwo);
  });

  teardown(async () => {
    await helper.rabbit.deleteQueue(namespaceOne);
    await helper.rabbit.deleteQueue(namespaceTwo);
    await helper.rabbit.deleteQueue(taskClusterQueueOne);
    await helper.rabbit.deleteQueue(taskClusterQueueTwo);
  });

  test('findTaskClusterQueues', async () => {
    const taskClusterQueueNames = await helper.monitor.findTaskClusterQueues();
    assert(!taskClusterQueueNames.includes(namespaceOne));
    assert(!taskClusterQueueNames.includes(namespaceTwo));
    assert(taskClusterQueueNames.includes(taskClusterQueueOne));
    assert(taskClusterQueueNames.includes(taskClusterQueueTwo));
  });

  test('namespace', () => {
    const namespace = helper.monitor.namespace(taskClusterQueueOne);
    assert.equal(namespace, namespaceOne);
  });

  test('collectStats', async () => {
    const queueNames = [namespaceOne, namespaceTwo];
    const stats = await helper.monitor.collectStats(queueNames);
    assert(stats.length === 2);
    assert(_.has(stats[0], 'queueName'));
    assert(_.has(stats[0], 'timestamp'));
    assert(_.has(stats[0], 'messages'));
    assert(_.has(stats[0], 'rate'));
  });

  test('monitorQueues', async () => {
    const stub = sinon.stub(helper.monitor, 'sendAlerts');

    const queueNames = [namespaceOne, namespaceTwo];
    const refreshTimes = 3;
    helper.monitor.refreshInterval = 50;
    await helper.monitor.monitorQueues(queueNames, refreshTimes);

    assert.equal(stub.callCount, 3);
    helper.monitor.sendAlerts.restore();
  });

  test('sendAlerts', async () => {
    const dummyNamespaceResponse = {
      contact: {
        method: 'email',
        payload: {
          address: 'a@a.com',
          subject: 'subject',
          content: 'content',
        },
      },
    };
    const messages = 10;
    const rate = 0.1;
    const dummyStats = [
      new RabbitMonitor.Stats(taskClusterQueueOne, messages, rate),
      new RabbitMonitor.Stats(taskClusterQueueTwo, messages, rate),
    ];
    const namespaceStub = sinon.stub(helper.monitor.pulse, 'namespace', (namespace) => dummyNamespaceResponse);
    const sendAlertStub = sinon.stub(helper.monitor.rabbitAlerter, 'sendAlert');

    await helper.monitor.sendAlerts(dummyStats);

    assert.equal(namespaceStub.callCount, 2);
    assert.equal(sendAlertStub.callCount, 2);

    helper.monitor.pulse.namespace.restore();
    helper.monitor.rabbitAlerter.sendAlert.restore();
  });

  class NamespaceFixture {
    async setupAPI() {
      this.namespaces = await load('Namespaces', {profile: 'test', process: 'test'});
      await this.namespaces.ensureTable();
      await helper.monitor.pulse.createNamespace(namespaceOne, {
        contact: {
          method: 'email',
          payload: {
            address: 'a@a.com',
            subject: 'subject',
            content: 'content',
          },
        },
      });
      await helper.monitor.pulse.createNamespace(namespaceTwo, {
        contact: {
          method: 'irc',
          payload: {
            channel: '#taskcluster-test',
            message: 'test',
          },
        },
      });
      // TODO: Once the pulse contact method schema is available, test that one as well.
    }

    async teardownAPI() {
      await this.namespaces.removeTable();
    }
  }

  // This test does its best at simulating the production/dev environment
  // for monitoring the status RabbitMQ message queues.
  test('runAndStop', async () => {
    const namespaceFixture = new NamespaceFixture();
    await namespaceFixture.setupAPI();

    helper.monitor.refreshInterval = 50;
    helper.monitor.run();

    const afterTimeout = async (resolvePromise, rejectPromise) => {
      try {
        assert(helper.monitor.monitoringInterval);
        helper.monitor.stop();
        assert(helper.monitor.monitoringInterval === undefined);
      } catch (error) {
        rejectPromise(error);
      }
      resolvePromise();
    };

    await new Promise((resolve, reject) => {
      const runForMillis = 100;
      setTimeout(async () => await afterTimeout(resolve, reject), runForMillis);
    });

    await namespaceFixture.teardownAPI();
  });
});
