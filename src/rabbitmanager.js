/**
 * An interface to interacting with rabbitmq management api.
 *
 * Eventually, this can be broken out into its own package
 * if we find that it is sufficiently useful and generic.
 * With that in mind, this should not have any taskcluster-pulse
 * specific logic in it.
 */

const assert = require('assert');
const rp = require('request-promise');
const slugid = require('slugid');
const _ = require('lodash');

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
      headers: {'Content-Type': 'application/json'},
      transform: (body) => {
        if (body !== '') {
          return JSON.parse(body);
        }
        return '';
      },
      // Instructs Request to throw exceptions whenever the response code is not 2xx.
      simple: true,
    };
  }

  request(endpoint, optionsOverride = {}) {
    optionsOverride['uri'] = endpoint;
    let options = Object.assign({}, this.options, optionsOverride);
    return rp(options);
  }

  async overview() {
    return await this.request('overview');
  }

  async clusterName() {
    return await this.request('cluster-name');
  }

  async createUser(name, password, tags) {
    let payload = {
      password: password,
      tags: tags,
    };

    let response = await this.request(`users/${name}`, {
      body: JSON.stringify(payload),
      method: 'PUT',
    });
  }

  async deleteUser(name) {
    let response = await this.request(`users/${name}`, {
      method: 'delete',
    });
  }

  async users() {
    return await this.request('users');
  }

  async usersWithAllTags(tags=[]) {
    let userList = await users();
    return _filterUsersWithAllTags(userList, tags);
  }

  _filterUsersWithAllTags(userList, tags) {
    let delimiter = ',';
    return userList.filter(user => {
      let userTagTokens = user.tags.split(delimiter);
      return _.difference(tags, userTagTokens).length === 0;
    });
  }

  async usersWithAnyTags(tags=[]) {
    let userList = await users();
    return _filterUsersWithAnyTags(userList, tags);
  }

  _filterUsersWithAnyTags(userList, tags) {
    let delimiter = ',';
    return userList.filter(user => {
      let userTagTokens = user.tags.split(delimiter);
      return _.intersection(tags, userTagTokens).length > 0;
    });
  }
}

module.exports = RabbitManager;
