/**
 * A useful tool for adding stress to a RabbitMQ queue.
 */
const amqp = require('amqplib');
const assert = require('assert');
const RabbitManager = require('../lib/rabbitmanager');

class RabbitStressor {
  /**
   * @param {number} payloadSize       - The size of each message being sent to the queue
   * @param {number} uploadRate        - Interval in milliseconds at which messages uploaded
   *                                     to the target queue
   * @param {number} messageCount      - The number of messages to send
   * @param {string} amqpUrl           - The AMQP url to connect to. Eg. amqp://localhost
   * @param {string} targetQueue       - The name of the queue where messages are uploaded to
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

  async connect() {
    this.connection = await amqp.connect(this.amqpUrl);
    this.channel = await this.connection.createChannel();
  }

  async sendMessages(queueName, messages, delayBetweenMessages) {
    assert(this.channel);
    assert(messages instanceof Array);
    try {
      await this.rabbitManager.queue(queueName);
    } catch (err) {
      await this.rabbitManager.createQueue(queueName);
    }
    return new Promise(resolve => this._sendMessagesOverInterval(queueName, messages, delayBetweenMessages, resolve));
  }

  async run() {
    const payload = this._generatePayload();
    const messages = Array(this.messageCount).fill(payload);
    await this.sendMessages(this.targetQueue, messages, this.uploadRate);
  }

  disconnect() {
    assert(this.connection);
    this.connection.close();
  }

  _generatePayload() {
    return Array(this.payloadSize + 1).join('X');
  }

  _sendMessagesOverInterval(queueName, messages, delayBetweenMessages, resolvePromise) {
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
