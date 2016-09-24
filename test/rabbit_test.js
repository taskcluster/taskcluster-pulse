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
    await helper.rabbit.createUser(name, name, '');
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
    let usersList = await helper.rabbit.users();
    assert(usersList instanceof Array);
    assert(_.has(usersList[0], 'name'));
    assert(_.has(usersList[0], 'password_hash'));
    assert(_.has(usersList[0], 'hashing_algorithm'));
    assert(_.has(usersList[0], 'tags'));
  });

  test('_filterUsersWithAllTags', () => {
    const user1 = { tags: 'foo,bar' };
    const user2 = { tags: 'foo' };
    const user3 = { tags: 'bar' };
    const user4 = { tags: 'bar,foo' };

    const users = [ user1, user2, user3, user4 ];
    const tags = ['foo', 'bar'];

    let usersWithAllTags = helper.rabbit._filterUsersWithAllTags(users, tags);
    assert(usersWithAllTags.length === 2);
    assert(_.find(usersWithAllTags, { tags: 'foo,bar' }));
    assert(_.find(usersWithAllTags, { tags: 'bar,foo' }));
  });

  test('_filterUsersWithAnyTags', () => {
    const user1 = { tags: 'foo,bar' };
    const user2 = { tags: 'foo' };
    const user3 = { tags: 'bar' };
    const user4 = { tags: 'bar,foo' };
    const user5 = { tags: 'car, foo' };

    const users = [ user1, user2, user3, user4, user5 ];
    const tags = ['bar', 'car'];

    let usersWithAnyTags = helper.rabbit._filterUsersWithAnyTags(users, tags);
    assert(usersWithAnyTags.length === 4);
    assert.equal(usersWithAnyTags.filter(user => user.tags.includes('bar')).length, 3);
    assert.equal(usersWithAnyTags.filter(user => user.tags.includes('car')).length, 1);
  });
});
