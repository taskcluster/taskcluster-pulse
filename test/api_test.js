suite('API', () => {
  let assert = require('assert');
  let helper = require('./helper');

  test('ping', () => {
    return helper.pulse.ping();
  });
});
