/**
 * An interface to stress test RabbitMQ queues.
 */

const amqp = require('amqplib');
const assert = require('assert');
const Rx = require('rxjs');

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

    const messageStream = Rx.Observable.from(messages)
    .zip(Rx.Observable.interval(delayBetweenMessages), (message) => {
      return message;
    });

    // Returning a promise gives the option to upload messages asynchronously
    return new Promise((resolve, reject) => {
      messageStream.subscribe((message) => {
        this.channel.sendToQueue(queueName, new Buffer(message));
      },
      (error) => {
        reject(error);
      },
      () => {
        resolve();
      });
    });
  }
}

module.exports = RabbitStressor;
