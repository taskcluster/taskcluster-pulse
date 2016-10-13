suite('Rabbit Stressor', () => {
  const assert = require('assert');
  const _ = require('lodash');
  const helper = require('./helper');

  test('connect', async () => {
    await helper.stressor.connect('amqp://localhost');
  });

  test('connectError', async () => {
    try {
      await helper.stressor.connect('not an amqp url');
      assert.equal(true, false);
    } catch (error) {
      assert(error);
    }
  });

  const sendStringMessages = async (delayBetweenMessages) => {
    const queueName = 'stress queue';
    const messages = ['some', 'string', 'messages', 'being', 'sent'];

    await helper.rabbit.createQueue(queueName);
    await helper.stressor.sendMessages(queueName, messages, delayBetweenMessages);

    const messagesFromQueue = await helper.rabbit.messagesFromQueue(queueName);
    assert(messagesFromQueue.length > 0, 'Did not receive any messages from queue');

    await helper.rabbit.deleteQueue(queueName);
  };

  test('sendStringMessagesNoDelay', async () => {
    const delayBetweenMessages = 0;
    await sendStringMessages(delayBetweenMessages);
  });

  test('sendStringMessagesWithDelay', async() => {
    const delayBetweenMessages = 50;
    await sendStringMessages(delayBetweenMessages);
  });

});
