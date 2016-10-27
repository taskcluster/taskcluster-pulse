/**
 * An interface which monitors all rabbitmq queues whose names
 * start with taskcluster/
 *
 * Statistics are then generated based off each queue's status.
 */

const assert = require('assert');

class RabbitMonitor {
  /**
   * @param {string} amqpUrl           - The AMQP url to connect to. Eg. amqp://localhost
   * @param {number} refreshInterval   - Interval in milliseconds at which new
   *                                     statistics are produced from
   *                                     monitoring taskcluster queues
   */
  constructor({amqpUrl, refreshInterval}, rabbitManager) {
    assert(amqpUrl, 'Must provide an AMQP URL!');
    assert(refreshInterval, 'Must provide an interval to monitor the queues!');
    assert(rabbitManager, 'Must provide a rabbit manager!');
    this.amqpUrl = amqpUrl;
    this.refreshInterval = refreshInterval;
    this.rabbitManager = rabbitManager;
  }

  async run() {
    const queueNames = await this.findTaskClusterQueues();
    if (queueNames.length > 0) {
      await this.monitorQueues(queueNames);
    }
  }

  async findTaskClusterQueues() {
    const queues = await this.rabbitManager.queues();
    return queues.map(queue => queue.name).filter(queueName => queueName.startsWith('taskcluster/'));
  }

  /**
   * Start monitoring queues for stats. The promise will only be resolved when
   * refreshTimes > 0.
   *
   * @param {Array.<string>} queueName   - The names of the queues we wish to monitor
   * @param {number} refreshTimes        - The number of times we wish to query the queues for stats.
   *                                       If this is 0, then the queues will be
   *                                       monitered until RabbitMonitor.stop() is called.
   */
  monitorQueues(queueNames, refreshTimes=0) {
    return new Promise(resolve => this._monitorQueuesOverInterval(queueNames, refreshTimes, resolve));
  }

  stop() {
    assert(this.monitoringInterval);
    clearInterval(this.monitoringInterval);
    delete this.monitoringInterval;
  }

  async collectStats(queueNames) {
    return await Promise.all(queueNames.map(async queueName => this._createStats(queueName)));
  }

  async _createStats(queueName) {
    const queue = await this.rabbitManager.queue(queueName);
    const stats = {
      queueName: queueName,
      timestamp: Date.now(),
      messages: queue.messages,
      rate: queue.messages_details.rate,
    };
    return stats;
  }

  _monitorQueuesOverInterval(queueNames, refreshTimes, resolvePromise) {
    if (this.monitoringInterval) {
      console.warn('Already monitoring queues, aborting operation.');
      return;
    }

    let timesMonitored = 0;
    this.monitoringInterval = setInterval(async () => {
      if (refreshTimes > 0) {
        if (timesMonitored >= refreshTimes) {
          resolvePromise();
          this.stop();
          return;
        }
        timesMonitored++;
      }
      this.stats = await this.collectStats(queueNames);
    }, this.refreshInterval);
  }
}

module.exports = RabbitMonitor;
