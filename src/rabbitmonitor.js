/**
 * A monitoring and alerting system for messaage queues.
 * @module rabbitmonitor
 */
const assert = require('assert');
const taskcluster = require('taskcluster-client');

/**
 * An interface for monitoring all rabbitmq queues whose names
 * start with taskcluster/
 *
 * Statistics are then generated based off each queue's status.
 * @class RabbitMonitor
 */
class RabbitMonitor {
  /**
   * @param {number} config.monitor.refreshInterval - Interval in milliseconds at which new
   *                                                  statistics are produced from
   *                                                  monitoring taskcluster queues.
   * @param {string} config.taskcluster.amqpUrl     - The AMQP url to connect to. Eg. amqp://localhost.
   * @param {RabbitAlerter} rabbitAlerter           - Sends alerts based off various message queue statistics.
   * @param {RabbitManager} rabbitManager           - RabbitMQ client.
   * @param {TaskClusterClient} pulse               - TaskCluster Pulse client.
   */
  constructor(refreshInterval, namespacePrefix, amqpUrl, rabbitAlerter, rabbitManager, pulse) {
    assert(refreshInterval, 'Must provide an interval to monitor the queues!');
    assert(namespacePrefix, 'Must provide a prefix for the taskcluster queue names!');
    assert(amqpUrl, 'Must provide an AMQP URL!');
    assert(rabbitAlerter, 'Must provide a rabbit alerter!');
    assert(rabbitManager, 'Must provide a rabbit manager!');
    assert(pulse, 'Must provide a TaskCluster Pulse client!');
    this.amqpUrl = amqpUrl;
    this.refreshInterval = refreshInterval;
    this.rabbitManager = rabbitManager;
    this.rabbitAlerter = rabbitAlerter;
    this.pulse = pulse;
    this.queuePrefix = '/queue/' + namespacePrefix;
  }

  // useful code for deleting connections, queues, exchanges for a namespace - copied here
  // when this functionality was removed from the API
  async usefulStuff() {
    // use the configuration regexp to determine if an object is owned by this
    // user, being careful to check that the namespace doesn't contain any funny
    // charcters (this is checked when the namespace is created, too)
    assert(namespace.length <= 64 && /^[A-Za-z0-9_-]+$/.test(namespace));
    let owned = new RegExp(cfg.app.userConfigPermission.replace(/{{namespace}}/g, namespace));

    let connections = await rabbitManager.connections(cfg.app.virtualhost);
    let nsRegex = new RegExp(`${namespace}-[0-9]+`);
    await Promise.all(connections.filter(c => nsRegex.test(c.user)).map(
      conn => rabbitManager.terminateConnection(conn.name, 'Namespace deleted')));

    // find the user's exchanges and queues
    let exchanges = _.filter(await rabbitManager.exchanges(),
      e => e.vhost === cfg.app.virtualhost && owned.test(e.name));
    let queues = _.filter(await rabbitManager.queues(),
      q => q.vhost === cfg.app.virtualhost && owned.test(q.name));

    // delete sequentually to avoid overloading the rabbitmq server
    for (let i = 0; i < exchanges.length; i++) {
      let name = exchanges[i].name;
      debug(`deleting exchange ${name}`);
      await rabbitManager.deleteExchange(name, cfg.app.virtualhost);
    }
    for (let i = 0; i < queues.length; i++) {
      let name = queues[i].name;
      debug(`deleting queue ${name}`);
      await rabbitManager.deleteQueue(name, cfg.app.virtualhost);
    }
  }

  /**
   *  Start the monitor.
   *  @param {boolean} verbose   - Enable to log queue statistics in real time
   */
  async run(verbose=false) {
    // TODO: finish RabbitMonitor
    throw new Error('rabbitmonitor isn\'t working yet');

    const queueNames = await this.findTaskClusterQueues();
    if (queueNames.length > 0) {
      await this.monitorQueues(queueNames, verbose);
    } else {
      throw new Error(`Could not find any queues prefixed with ${this.queuePrefix}`);
    }
  }

  /**
   *  Finds all names of existing queues whose names begin with the taskcluster
   *  queue prefix.
   *
   *  @returns {Array.<string>}
   */
  async findTaskClusterQueues() {
    const queues = await this.rabbitManager.queues();
    return queues.map(queue => queue.name).filter(queueName => queueName.startsWith(this.queuePrefix));
  }

  /**
   *  @param {string} taskClusterQueueName
   *  @returns {string} The namespace given a taskcluster queue name.
   */
  namespace(taskClusterQueueName) {
    const search = this.queuePrefix;
    const position = taskClusterQueueName.indexOf(search) + search.length;
    return taskClusterQueueName.substring(position);
  }

  /**
   * Start monitoring queues for stats. The promise will only be resolved when
   * snapshots > 0.
   *
   * @param {Array.<string>} queueName   - The names of the queues we wish to monitor.
   * @param {boolean} verbose            - Enable to log stats in real time.
   * @param {number} snapshots           - The number of times we wish to query the queues for stats.
   *                                       If this is 0, then the queues will be
   *                                       monitered until RabbitMonitor.stop() is called.
   */
  monitorQueues(queueNames, verbose=false, snapshots=0) {
    return new Promise(resolve => this.monitorQueuesOverInterval(queueNames, snapshots, resolve, verbose));
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
  collectStats(queueNames) {
    return Promise.all(queueNames.map(async queueName => {
      const queue = await this.rabbitManager.queue(queueName);
      console.log(JSON.stringify(queue, null, 2));
      // TODO: wtf is messages_details?
      return new RabbitMonitor.Stats(queue.name, queue.messages, queue.messages_details.rate);
    }));
  }

  /**
   * Takes snapshots of statistics over time intervals.
   *
   * @private
   * @param {Array.<string>} queueNames  - The names of the queues we wish to sample statistics from.
   * @param {number} snapshots           - The amount of snapshots of statistics to take before halting.
   * @param {resolve} resolvePromise     - Call this to resolve the promise.
   * @param {boolean} verbose            - Enable to log stats in real time.
   */
  monitorQueuesOverInterval(queueNames, snapshots, resolvePromise, verbose) {
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

      const stats = await this.collectStats(queueNames);
      if (verbose) {
        console.log(stats);
      }
      this.sendAlerts(stats);
    }, this.refreshInterval);
  }

  /**
   * @param {Array.<RabbitMonitor.Stats>} stats
   */
  async sendAlerts(stats) {
    // TODO: What if the queue or namespace suddenly disappears?
    const promises = stats.map(currentStats => {
      const namespace = this.namespace(currentStats.queueName);
      const namespaceResponse = this.pulse.namespace(namespace);
      return namespaceResponse._properties;
    });
    const namespaceResponses = await Promise.all(promises);
    namespaceResponses.forEach((namespaceProperties, index) => {
      this.rabbitAlerter.sendAlert(stats[index], namespaceProperties);
    });
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
RabbitMonitor.Stats = class {
  constructor(queueName, messages, rate) {
    this.queueName = queueName;
    this.timestamp = Date.now();
    this.messages = messages;
    this.rate = rate;
  }
};

module.exports = RabbitMonitor;
