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

  sendMessages(queueName, messages) {
    assert(messages instanceof Array);
    this.channel.assertQueue(queueName, {durable: false});
    messages.forEach(message => this.channel.sendToQueue(queueName, new Buffer(message)));
  }
}

module.exports = RabbitStressor;
