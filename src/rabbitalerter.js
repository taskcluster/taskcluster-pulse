/**
 * An alerting system for message queues.
 * @module rabbitalerter
 */
const assert = require('assert');
const taskcluster = require('taskcluster-client');

/**
 * An interface used to generate various TaskCluster Notifications.
 *
 * @class RabbitAlerter
 */
class RabbitAlerter {
  /**
   * @param {number} config.alerter.messageCountTolerance       - When a queue holds more messages
   *                                                              than this tolerance, an alert will be created.
   * @param {number} config.alerter.messagePublishRateTolerance - When the number of messages published per second
   *                                                              exceed this tolerance, an alert will be created.
   * @param {Object} credentials                                - TaskCluster credentials.
   */
  constructor({messageCountTolerance, messagePublishRateTolerance}, credentials) {
    assert(messageCountTolerance, 'Must provide a message count tolerance!');
    assert(messagePublishRateTolerance, 'Must provide a message publish rate tolerance!');
    assert(credentials.clientId, 'TaskCluster credentials requires a clientId!');
    assert(credentials.accessToken, 'TaskCluster credentials requires an accessToken!');
    this.notifier = new taskcluster.Notify({credentials});
    this.pulse = new taskcluster.Pulse();
    this.messageCountTolerance = messageCountTolerance;
    this.messagePublishRateTolerance = messagePublishRateTolerance;
  }

  /**
   * @param {RabbitMonitor.Stats} stats
   * @return {Boolean}
   */
  anyTolearanceExceeded(stats) {
    return this.messagesExceeded(stats) || this.messagePublishRateExceeded(stats);
  }

  /**
   * @param {RabbitMonitor.Stats} stats
   * @return {Boolean}
   */
  messagesExceeded(stats) {
    return stats.messages > this.messageCountTolerance;
  }

  /**
   * @param {RabbitMonitor.Stats} stats
   * @return {Boolean}
   */
  messagePublishRateExceeded(stats) {
    return stats.rate > this.messagePublishRateTolerance;
  }

  /**
   * @param {RabbitMonitor.Stats} stats
   * @param {Object} namespace            - Determines which kind of alert to create.
   * @returns {RabbitAlerter.Alert}       - An alert variant.
   */
  createAlert(stats, namespace) {
    const contactMethod = namespace.contact.method;
    const payload = namespace.contact.payload;
    switch (contactMethod) {
      case 'pulse':
        return new RabbitAlerter.PulseAlert(stats, this.notifier, payload.routingKey);
      case 'email':
        return new RabbitAlerter.EmailAlert(stats, this.notifier, payload.address);
      case 'irc':
        return new RabbitAlerter.IRCAlert(stats, this.notifier, payload.channel);
      default:
        let warning = 'Cannot identify contact method in namespace.\n';
        warning += 'Currently supported methods are: "pulse", "email", and "irc"';
        console.warn(warning);
    }
  }

  /**
   * Sends an alert given the provided stats
   *
   * @param {RabbitMonitor.Stats} stats
   */
  // TODO: The namespace response should be fetched from the pulse api
  sendAlert(stats, namespace) {
    if (!this.anyTolearanceExceeded(stats)) {
      return;
    }
    const alert = this.createAlert(stats, namespace);
    if (alert !== undefined) {
      if (this.messagesExceeded(stats)) {
        alert.messagesExceeded();
      }
      if (this.messagePublishRateExceeded(stats)) {
        alert.messagePublishRateExceeded();
      }
      alert.notify();
    }
  }
};

/**
 * A generic template for creating different alert variants.
 *
 * @class Alert
 */
RabbitAlerter.Alert = class {
  /**
   * Reference on the payloads for various alerts:
   * https://github.com/taskcluster/taskcluster-notify/blob/master/test/api_test.js
   *
   * @param {RabbitMonitor.Stats} stats
   * @param {Object} notifier           - TaskCluter Notifier Client.
   */
  constructor(stats, notifier) {
    assert(this.notify, 'Alert.notify needs to be overridden!');
    this.payload = {};
    this.stats = stats;
    this.notifier = notifier;
  }

  messagesExceeded() {
    if (this.payload.message) {
      this.payload.message += `- Message Count: ${this.stats.messages} `;
      this.payload.message += `exceeds the tolerance of ${this.messageCountTolerance}\n`;
    }
  }

  messagePublishRateExceeded() {
    if (this.payload.message) {
      this.payload.message += `- Message Publish Rate: ${this.stats.rate} `;
      this.payload.message += `exceeds the tolerance of ${this.messagePublishRateTolerance}\n`;
    }
  }
};

/** @class PulseAlert */
RabbitAlerter.PulseAlert = class extends RabbitAlerter.Alert {
  /**
   * @param {RabbitMonitor.Stats} stats
   * @param {string} routingKey
   */
  constructor(stats, notifier, routingKey) {
    super(stats, notifier);
    this.payload.routingKey = routingKey;
    this.payload.message = 'Alert from TaskCluster-Pulse:\n';
    this.payload.message += `The queue ${this.stats.queueName} has exceeded the following thresholds:\n`;
  }

  /** @override */
  async notify() {
    this.notifier.pulse(this.payload);
  }
};

/** @class EmailAlert */
RabbitAlerter.EmailAlert  = class extends RabbitAlerter.Alert {
  /**
   * @param {RabbitMonitor.Stats} stats
   * @param {string} address             - An email address.
   */
  constructor(stats, notifier, address) {
    super(stats, notifier);
    this.payload = {};
    this.payload.address = address;
    this.payload.subject = 'TaskCluster-Pulse alert: ${this.stats.queueName}';
    this.payload.content = 'Alert from TaskCluster-Pulse:\n';
    this.payload.content += `The queue *${this.stats.queueName}* has exceeded the following thresholds:\n`;
  }

 /** @override */
  messagesExceeded() {
    this.payload.content += `* Message Count: *${this.stats.messages}* exceeds `;
    this.payload.content += `the tolerance of *${this.messageCountTolerance}*\n`;
  }

  /** @override */
  messagePublishRateExceeded() {
    this.payload.content += `* Message Publish Rate: ${this.stats.rate} exceeds `;
    this.payload.content += `the tolerance of ${this.messagePublishRateTolerance}\n`;
  }

  /** @override */
  async notify() {
    this.notifier.email(this.payload);
  }
};

/** @class IRCAlert */
RabbitAlerter.IRCAlert = class extends RabbitAlerter.Alert {
  /**
   * @param {RabbitMonitor.Stats} stats
   * @param {string} channel            - IRC channel.
   */
  constructor(stats, notifier, channel) {
    super(stats, notifier);
    this.payload.channel = channel;
    this.payload.message = 'Alert from TaskCluster-Pulse:\n';
    this.payload.message += `The queue ${this.stats.queueName} has exceeded the following thresholds:\n`;
  }

  /** @override */
  async notify() {
    this.notifier.irc(this.payload);
  }
};

module.exports = RabbitAlerter;
