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

  test('sendStringMessages', async () => {
    const queueName = 'stress queue';
    const messages = ['some', 'string', 'messages', 'being', 'sent'];

    await helper.rabbit.createQueue(queueName);
    helper.stressor.sendMessages(queueName, messages);

    const messagesFromQueue = await helper.rabbit.messagesFromQueue(queueName);

    assert.equal(messagesFromQueue[0].payload, messages[0]);
    assert.equal(messagesFromQueue[1].payload, messages[1]);
    assert.equal(messagesFromQueue[2].payload, messages[2]);
    assert.equal(messagesFromQueue[3].payload, messages[3]);
    assert.equal(messagesFromQueue[4].payload, messages[4]);

    await helper.rabbit.deleteQueue(queueName);
  });

});
