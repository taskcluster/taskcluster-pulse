/**
 * An interface to interacting with rabbitmq management api.
 *
 * Eventually, this can be broken out into its own package
 * if we find that it is sufficiently useful and generic.
 * With that in mind, this should not have any taskcluster-pulse
 * specific logic in it.
 */

let assert = require('assert');
let rp = require('request-promise');

class RabbitManager {
  constructor({username, password, baseUrl}) {
    assert(username, 'Must provide a rabbitmq username!');
    assert(password, 'Must provide a rabbitmq password!');
    assert(baseUrl, 'Must provide a rabbitmq baseUrl!');
    this.request = rp.defaults({
      baseUrl,
      auth: {
        username,
        password,
        sendImmediately: false,
      },
      json: true,
    });
  }

  async overview() {
    return await this.request('overview');
  }

  async clusterName() {
    return await this.request('cluster-name');
  }
}

module.exports = RabbitManager;
