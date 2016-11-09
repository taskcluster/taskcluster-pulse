suite('Rabbit Monitor', () => {
  const assert = require('assert');
  const sinon = require('sinon');
  const _ = require('lodash');
  const helper = require('./helper');

  const queueOne = 'one';
  const queueTwo = 'two';
  const taskClusterQueueOne = 'taskcluster/one';
  const taskClusterQueueTwo = 'taskcluster/two';

  setup(async () => {
    sinon.spy(helper.monitor.rabbitAlerter, 'sendAlert');
    await helper.rabbit.createQueue(queueOne);
    await helper.rabbit.createQueue(queueTwo);
    await helper.rabbit.createQueue(taskClusterQueueOne);
    await helper.rabbit.createQueue(taskClusterQueueTwo);
  });

  teardown(async () => {
    helper.monitor.rabbitAlerter.sendAlert.restore();
    await helper.rabbit.deleteQueue(queueOne);
    await helper.rabbit.deleteQueue(queueTwo);
    await helper.rabbit.deleteQueue(taskClusterQueueOne);
    await helper.rabbit.deleteQueue(taskClusterQueueTwo);
  });

  test('findTaskClusterQueues', async () => {
    const taskClusterQueueNames = await helper.monitor.findTaskClusterQueues();
    assert(!taskClusterQueueNames.includes(queueOne));
    assert(!taskClusterQueueNames.includes(queueTwo));
    assert(taskClusterQueueNames.includes(taskClusterQueueOne));
    assert(taskClusterQueueNames.includes(taskClusterQueueTwo));
  });

  test('collectStats', async () => {
    const queueNames = [queueOne, queueTwo];
    const stats = await helper.monitor.collectStats(queueNames);
    assert(stats.length === 2);
    assert(_.has(stats[0], 'queueName'));
    assert(_.has(stats[0], 'timestamp'));
    assert(_.has(stats[0], 'messages'));
    assert(_.has(stats[0], 'rate'));
  });

  test.skip('monitorQueues', async () => {
    const queueNames = [queueOne, queueTwo];
    const refreshTimes = 3;
    helper.monitor.refreshInterval = 50;
    await helper.monitor.monitorQueues(queueNames, refreshTimes);

    assert.equal(helper.monitor.rabbitAlerter.sendAlert.callCount, 6);
  });

  test.skip('runAndStop', async () => {
    helper.monitor.collectStats = sinon.spy();
    helper.monitor.refreshInterval = 50;
    helper.monitor.run();

    const afterTimeout = async (resolvePromise, rejectPromise) => {
      try {
        assert(helper.monitor.monitoringInterval);
        helper.monitor.stop();
        assert(helper.monitor.monitoringInterval === undefined);
        assert(helper.monitor.rabbitAlerter.sendAlert.calledTwice);
      } catch (error) {
        rejectPromise(error);
      }
      resolvePromise();
    };

    await new Promise((resolve, reject) => {
      const runForMillis = 100;
      setTimeout(async () => await afterTimeout(resolve, reject), runForMillis);
    });
  });
});
