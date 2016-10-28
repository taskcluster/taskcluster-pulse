/**
 * A useful tool for adding stress to a RabbitMQ queue.
 * @module rabbitstressor
 */
const amqp = require('amqplib');
const assert = require('assert');
const RabbitManager = require('../lib/rabbitmanager');

/**
 * An interface which can be used to stress test RabbitMQ queues.
 * @class RabbitStressor
 */
class RabbitStressor {
  /**
   * @param {number} payloadSize           - The size of each message being sent to the queue.
   * @param {number} uploadRate            - Interval in milliseconds at which messages uploaded
   *                                         to the target queue.
   * @param {number} messageCount          - The number of messages to send.
   * @param {string} amqpUrl               - The AMQP url to connect to. Eg. amqp://localhost.
   * @param {string} targetQueue           - The name of the queue where messages are uploaded to.
   * @param {RabbitManager} rabbitManager
   */
  constructor({payloadSize, uploadRate, messageCount, amqpUrl, targetQueue}, rabbitManager) {
    assert(payloadSize, 'Must provide a payload size!');
    assert(uploadRate, 'Must provide a upload rate!');
    assert(messageCount, 'Must provide a number of messages to send!');
    assert(amqpUrl, 'Must provide an AMQP URL!');
    assert(targetQueue, 'Must provide a target queue name!');
    assert(rabbitManager, 'Must provide a valid Rabbit Manager!');
    this.payloadSize = payloadSize;
    this.uploadRate = uploadRate;
    this.targetQueue = targetQueue;
    this.messageCount = messageCount;
    this.amqpUrl = amqpUrl;
    this.rabbitManager = rabbitManager;
  }

  /**
   *  Initiate an AMQP connection. This must be done before performing any
   *  stress testing operation.
   */
  async connect() {
    this.connection = await amqp.connect(this.amqpUrl);
    this.channel = await this.connection.createChannel();
  }

  /**
   *  Send messages to a queue.
   *
   *  @param {string} queueName            - The queue where we wish to publish messages to.
   *  @param {Array.<Object>} messages     - The messages to send.
   *  @param {number} delayBetweenMessages - The delay in milliseconds between each published message.
   *  @returns {Promise<Void>}             - Promise is resolved once all messages have been sent.
   */
  async sendMessages(queueName, messages, delayBetweenMessages) {
    assert(this.channel);
    assert(messages instanceof Array);
    try {
      await this.rabbitManager.queue(queueName);
    } catch (err) {
      await this.rabbitManager.createQueue(queueName);
    }
    return new Promise(resolve => this.sendMessagesOverInterval(queueName, messages, delayBetweenMessages, resolve));
  }

  /**
   *  Run the rabbit stressor as a standalone tool.
   */
  async run() {
    const payload = this.generatePayload();
    const messages = Array(this.messageCount).fill(payload);
    await this.sendMessages(this.targetQueue, messages, this.uploadRate);
  }

  /**
   *  Closes the AMQP connection.
   */
  disconnect() {
    assert(this.connection);
    this.connection.close();
  }

  /**
   *  Generates payload data used for stress testing.
   *
   *  @private
   *  @returns {Array.<string>}
   */
  generatePayload() {
    return Array(this.payloadSize + 1).join('X');
  }

  /**
   * Sends messages over time.
   *
   * @private
   * @param {string} queueName
   * @param {Array.<Object>} messages
   * @param {number} delayBetweenMessages
   * @param {resolve} resolvePromise      - Call this to resolve the promise.
   */
  sendMessagesOverInterval(queueName, messages, delayBetweenMessages, resolvePromise) {
    let index = 0;
    const intervalId = setInterval(() => {
      if (index >= messages.length) {
        clearInterval(intervalId);
        resolvePromise();
        return;
      }
      this.channel.sendToQueue(queueName, new Buffer(messages[index]));
      index++;
    }, delayBetweenMessages);
  }
}

module.exports = RabbitStressor;
