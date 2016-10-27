suite('Rabbit Wrapper', () => {
  const expect = require('chai').expect;
  const assert = require('assert');
  const slugid = require('slugid');
  const _ = require('lodash');
  const helper = require('./helper');

  test('overview', async () => {
    const overview = await helper.rabbit.overview();
    assert(_.has(overview, 'rabbitmq_version'));
    assert(_.has(overview, 'management_version'));
    assert(_.has(overview, 'cluster_name'));
  });

  test('clusterName', async () => {
    const clusterName = await helper.rabbit.clusterName();
    assert(_.has(clusterName, 'name'));
  });

  test('createAndDeleteUser', async () => {
    const name = slugid.v4();
    await helper.rabbit.createUser(name, name, []);
    await helper.rabbit.deleteUser(name);
  });

  test('deleteUserException', async () => {
    try {
      await helper.rabbit.deleteUser('not a user');
      assert.equal(true, false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('users', async () => {
    const usersList = await helper.rabbit.users();
    assert(usersList instanceof Array);
    assert(_.has(usersList[0], 'name'));
    assert(_.has(usersList[0], 'tags'));
  });

  test('usersWithAllTags', async () => {
    // Setup
    const name1 = 'A';
    const name2 = 'B';
    const name3 = 'C';
    const name4 = 'D';
    await helper.rabbit.createUser(name1, `${name1}password`, ['foo', 'bar']);
    await helper.rabbit.createUser(name2, `${name2}password`, ['foo']);
    await helper.rabbit.createUser(name3, `${name3}password`, ['bar']);
    await helper.rabbit.createUser(name4, `${name4}password`, ['bar', 'foo']);

    const tags = ['foo', 'bar'];
    const usersWithAllTags = await helper.rabbit.usersWithAllTags(tags);

    assert(usersWithAllTags.length === 2);
    assert(_.find(usersWithAllTags, {tags: 'foo,bar'}));
    assert(_.find(usersWithAllTags, {tags: 'bar,foo'}));

    // Cleanup
    await helper.rabbit.deleteUser(name1);
    await helper.rabbit.deleteUser(name2);
    await helper.rabbit.deleteUser(name3);
    await helper.rabbit.deleteUser(name4);
  });

  test('usersWithAnyTags', async () => {
    // Setup
    const name1 = 'E';
    const name2 = 'F';
    const name3 = 'G';
    const name4 = 'H';
    const name5 = 'I';
    await helper.rabbit.createUser(name1, `${name1}password`, ['moo', 'tar']);
    await helper.rabbit.createUser(name2, `${name2}password`, ['moo']);
    await helper.rabbit.createUser(name3, `${name3}password`, ['tar']);
    await helper.rabbit.createUser(name4, `${name4}password`, ['tar', 'moo']);
    await helper.rabbit.createUser(name5, `${name5}password`, ['car', 'moo']);

    const tags = ['tar', 'car'];
    const usersWithAnyTags = await helper.rabbit.usersWithAnyTags(tags);

    assert(usersWithAnyTags.length === 4);
    assert.equal(usersWithAnyTags.filter(user => user.tags.includes('tar')).length, 3);
    assert.equal(usersWithAnyTags.filter(user => user.tags.includes('car')).length, 1);

    // Cleanup
    await helper.rabbit.deleteUser(name1);
    await helper.rabbit.deleteUser(name2);
    await helper.rabbit.deleteUser(name3);
    await helper.rabbit.deleteUser(name4);
    await helper.rabbit.deleteUser(name5);
  });

  test('userPermissions_singleVhost', async () => {
    const name = slugid.v4();
    await helper.rabbit.createUser(name, name, []);
    await helper.rabbit.setUserPermissions(name, '/', '.*', '.*', '.*');
    let permissions = await helper.rabbit.userPermissions(name, '/');
    assert(_.has(permissions, 'user'));
    assert(_.has(permissions, 'vhost'));
    // Delete the permission and test the error case.
    await helper.rabbit.deleteUserPermissions(name, '/');
    try {
      await helper.rabbit.userPermissions(name, '/');
      assert(false);
    } catch (error) {
      expect(error.statusCode).to.equal(404);
    }
    await helper.rabbit.deleteUser(name);
  });

  test('userPermissions_allVhosts', async () => {
    const name = slugid.v4();
    await helper.rabbit.createUser(name, name, []);
    await helper.rabbit.setUserPermissions(name, '/', '.*', '.*', '.*');
    let permissions = await helper.rabbit.userPermissions(name);
    assert(permissions.length > 0);
    assert(_.has(permissions[0], 'user'));
    assert(_.has(permissions[0], 'vhost'));
    await helper.rabbit.deleteUser(name);
  });

  test('queues', async () => {
    // Setup
    const queueName = 'Temp queue';
    await helper.rabbit.createQueue(queueName);

    const queues = await helper.rabbit.queues();

    assert(queues instanceof Array);
    assert(_.has(queues[0], 'memory'));
    assert(_.has(queues[0], 'messages'));
    assert(_.has(queues[0], 'messages_details'));
    assert(_.has(queues[0], 'messages_ready'));
    assert(_.has(queues[0], 'name'));

    // Teardown
    await helper.rabbit.deleteQueue(queueName);
  });

  test('createGetDeleteQueue', async () => {
    const queueName = 'My message queue';
    await helper.rabbit.createQueue(queueName);

    const queue = await helper.rabbit.queue(queueName);
    assert.equal(queue.name, queueName);

    await helper.rabbit.deleteQueue(queueName);
  });

  test('deleteQueueNotFoundException', async () => {
    try {
      const queueName = 'not a queue';
      await helper.rabbit.deleteQueue(queueName);
      assert.equal(true, false);
    } catch (error) {
      assert.equal(error.statusCode, 404);
    }
  });

  test('messagesFromQueue', async () => {
    const queueName = 'temp';
    const messages = ['some', 'messages'];
    const delayBetweenMessages = 0;
    await helper.rabbit.createQueue(queueName);
    await helper.stressor.sendMessages(queueName, messages, delayBetweenMessages);

    const dequeuedMessages = await helper.rabbit.messagesFromQueue(queueName);

    assert(dequeuedMessages instanceof Array);
    assert(_.has(dequeuedMessages[0], 'payload_bytes'));
    assert(_.has(dequeuedMessages[0], 'redelivered'));
    assert(_.has(dequeuedMessages[0], 'exchange'));
    assert(_.has(dequeuedMessages[0], 'routing_key'));
    assert(_.has(dequeuedMessages[0], 'message_count'));
    assert(_.has(dequeuedMessages[0], 'properties'));

    await helper.rabbit.deleteQueue(queueName);
  });
});
