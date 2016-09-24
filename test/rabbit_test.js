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
      expect(true).to.be.false;
    } catch (error) {
      expect(error.statusCode).to.equal(404);
    }
  });
});
