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
    return new Promise(resolve => this._sendMessagesOverInterval(queueName, messages, delayBetweenMessages, resolve));
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
