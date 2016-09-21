suite('Rabbit Wrapper', () => {
  let assert = require('assert');
  let _ = require('lodash');
  let helper = require('./helper');

  test('overview', async () => {
    let overview = await helper.rabbit.overview();
    assert(_.has(overview, 'rabbitmq_version'));
    assert(_.has(overview, 'management_version'));
    assert(_.has(overview, 'cluster_name'));
  });
});
