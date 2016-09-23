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
let slugid = require('slugid');

class RabbitManager {
  constructor({username, password, baseUrl}) {
    assert(username, 'Must provide a rabbitmq username!');
    assert(password, 'Must provide a rabbitmq password!');
    assert(baseUrl, 'Must provide a rabbitmq baseUrl!');
    this.options = {
      baseUrl,
      auth: {
        username,
        password,
        sendImmediately: false,
      },
      headers: {'content-type': 'application/json'},
      simple: true
    };
  }

  requestFactory(optionsOverride = {}) {
    let options = Object.assign({}, this.options, optionsOverride);
    return rp.defaults(options);
  }

  async overview() {
    return JSON.parse(await this.requestFactory()('overview'));
  }

  async clusterName() {
    return JSON.parse(await this.requestFactory()('cluster-name'));
  }

  async createUser() {
    let name = slugid.v4();
    let payload = {
      password: name,
      tags: ""
    };

    let response = await this.requestFactory({
      body: JSON.stringify(payload),
      method: 'PUT',
    })(`users/${name}`);
    return name;
  }

  async deleteUser(name) {
    let response = await this.requestFactory({
      method: 'delete'
    })(`users/${name}`);
  }
}

module.exports = RabbitManager;
