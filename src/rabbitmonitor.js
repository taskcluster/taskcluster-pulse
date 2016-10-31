/**
 * A monitoring and alerting system for messaage queues.
 * @module rabbitmonitor
 */
const assert = require('assert');

/**
 * An interface for monitoring all rabbitmq queues whose names
 * start with taskcluster/
 *
 * Statistics are then generated based off each queue's status.
 * @class RabbitMonitor
 */
class RabbitMonitor {
  /**
   * @param {string} amqpUrl               - The AMQP url to connect to. Eg. amqp://localhost.
   * @param {number} refreshInterval       - Interval in milliseconds at which new
   *                                         statistics are produced from
   *                                         monitoring taskcluster queues.
   * @param {RabbitManager} rabbitManager
   */
  constructor({amqpUrl, refreshInterval}, rabbitManager) {
    assert(amqpUrl, 'Must provide an AMQP URL!');
    assert(refreshInterval, 'Must provide an interval to monitor the queues!');
    assert(rabbitManager, 'Must provide a rabbit manager!');
    this.amqpUrl = amqpUrl;
    this.refreshInterval = refreshInterval;
    this.rabbitManager = rabbitManager;
  }

  /**
   *  Start the monitor.
   */
  async run() {
    const queueNames = await this.findTaskClusterQueues();
    if (queueNames.length > 0) {
      await this.monitorQueues(queueNames);
    }
  }

  /**
   *  Finds all names of existing queues starting with taskcluster/
   *
   *  @returns {Array.<string>}
   */
  async findTaskClusterQueues() {
    const queues = await this.rabbitManager.queues();
    return queues.map(queue => queue.name).filter(queueName => queueName.startsWith('taskcluster/'));
  }

  /**
   * Start monitoring queues for stats. The promise will only be resolved when
   * snapshots > 0.
   *
   * @param {Array.<string>} queueName   - The names of the queues we wish to monitor.
   * @param {number} snapshots           - The number of times we wish to query the queues for stats.
   *                                       If this is 0, then the queues will be
   *                                       monitered until RabbitMonitor.stop() is called.
   */
  monitorQueues(queueNames, snapshots=0) {
    return new Promise(resolve => this.monitorQueuesOverInterval(queueNames, snapshots, resolve));
  }

  /**
   *  Stop monitoring the queues. Keep in mind that this will not resolve the
   *  promise from monitorQueues().
   */
  stop() {
    assert(this.monitoringInterval);
    clearInterval(this.monitoringInterval);
    delete this.monitoringInterval;
  }

  /**
   * Collects stats from the specified queues.
   *
   * @param {Array.<string>} queueNames - The names of the queues whose stats
   *                                      will be collected.
   * @returns {Array.<Object>}          - An array of stats from each queue
   *                                      once all promises have been resolved.
   */
  async collectStats(queueNames) {
    return await Promise.all(queueNames.map(async queueName => this.createStats(queueName)));
  }

  /**
   * @private
   * @param {string} queueName - The name of the queue from which we collect
   *                             stats from.
   * @returns {Stats}
   */
  async createStats(queueName) {
    const queue = await this.rabbitManager.queue(queueName);
    return new Stats(queueName, queue.messages, queue.messages_details.rate);
  }

  /**
   * Takes snapshots of statistics over time intervals.
   *
   * @private
   * @param {Array.<string>} queueNames  - The names of the queues we wish to sample statistics from.
   * @param {number} snapshots           - The amount of snapshots of statistics to take before halting.
   * @param {resolve} resolvePromise     - Call this to resolve the promise.
   */
  monitorQueuesOverInterval(queueNames, snapshots, resolvePromise) {
    if (this.monitoringInterval) {
      console.warn('Already monitoring queues, aborting operation.');
      return;
    }

    let timesMonitored = 0;
    this.monitoringInterval = setInterval(async () => {
      if (snapshots > 0) {
        if (timesMonitored >= snapshots) {
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

/**
 * A snapshot of statistics for a given queue.
 *
 * @class
 * @property {string} queueName - The name of the queue.
 * @property {number} timestamp - UNIX timestamp upon instantiation.
 * @property {number} messages  - The number of messsages.
 * @property {number} rate      - The amount of messages which are published to
 *                                the queue per second.
 */
class Stats {
  constructor(queueName, messages, rate) {
    this.queueName = queueName;
    this.timestamp = Date.now();
    this.messages = messages;
    this.rate = rate;
  }
}

module.exports = RabbitMonitor;
