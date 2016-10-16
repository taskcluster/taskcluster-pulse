/**
 * An interface to stress test RabbitMQ queues.
 */
const amqp = require('amqplib');
const assert = require('assert');


class RabbitStressor {
  constructor({amqpUrl}) {
    assert(amqpUrl, 'Must provide an AMQP URL!');
    this.connect(amqpUrl);
  }

  async connect(amqpUrl) {
    this.connection = await amqp.connect(amqpUrl);
    this.channel = await this.connection.createChannel();
  }

  sendMessages(queueName, messages, delayBetweenMessages) {
    assert(messages instanceof Array);
    this.channel.assertQueue(queueName, {durable: false});

    return new Promise(resolve => {
      this._recursiveTimeout(queueName, messages, delayBetweenMessages, resolve);
    });
  }

  _recursiveTimeout(queueName, messageQueue, delayBetweenMessages, resolve) {
    if (messageQueue.length <= 0) {
      resolve();
      return;
    }

    setTimeout(() => {
      this.channel.sendToQueue(queueName, new Buffer(messageQueue[0]));
      messageQueue.shift();
      this._recursiveTimeout(queueName, messageQueue, delayBetweenMessages, resolve);
    }, delayBetweenMessages);
  }
}

module.exports = RabbitStressor;
