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
    assert(tags instanceof Array);

    let payload = {
      password: password,
      tags: tags.join(),
    };

    let response = await this.request(`users/${name}`, {
      body: JSON.stringify(payload),
      method: 'put',
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

  async exchanges(){
    return await this.request('exchanges');
  }

  async usersWithAllTags(tags=[]) {
    let userList = await this.users();
    return this._filterUsersWithTags(userList, tags, _.difference, _.eq);
  }

  async usersWithAnyTags(tags=[]) {
    let userList = await this.users();
    return this._filterUsersWithTags(userList, tags, _.intersection, _.gt);
  }

  _filterUsersWithTags(userList, tags, combiner, comparator) {
    return userList.filter(user => {
      const userListTokens = user.tags.split(',');
      return comparator(combiner(tags, userListTokens).length, 0);
    });
  }

  async userPermissions(user, vhost='/') {
    vhost = encodeURIComponent(vhost);
    return await this.request(`permissions/${vhost}/${user}`);
  }

  async setUserPermissions(user, vhost, configurePattern, writePattern, readPattern) {
    let permissions = {
      configure: configurePattern,
      write: writePattern,
      read: readPattern,
    };
    vhost = encodeURIComponent(vhost);
    await this.request(`permissions/${vhost}/${user}`, {
      body: JSON.stringify(permissions),
      method: 'PUT',
    });
  }

  async deleteUserPermissions(user, vhost='/') {
    vhost = encodeURIComponent(vhost);
    await this.request(`permissions/${vhost}/${user}`, {method: 'delete'});
  }

  async queues() {
    return await this.request('queues');
  }

  queueNameExists(name) {
    if (!name) {
      console.warn('Please provide a name for the queue!');
      return false;
    }
    return true;
  }

  encodeURIComponents(components) {
    const result = {};
    Object.keys(components).forEach(key => result[key] = encodeURIComponent(components[key]));
    return result;
  }

  async queue(name, vhost='/') {
    if (!this.queueNameExists(name)) {
      return;
    }
    const uriEncodedComponents = this.encodeURIComponents({name: name, vhost: vhost});
    return await this.request(`queues/${uriEncodedComponents.vhost}/${uriEncodedComponents.name}`);
  }

  async createQueue(name, options={}, vhost='/') {
    if (!this.queueNameExists(name)) {
      return;
    }
    const uriEncodedComponents = this.encodeURIComponents({name: name, vhost: vhost});
    return await this.request(`queues/${uriEncodedComponents.vhost}/${uriEncodedComponents.name}`, {
      body: JSON.stringify(options),
      method: 'put',
    });
  }

  async deleteQueue(name, vhost='/') {
    if (!this.queueNameExists(name)) {
      return;
    }
    const uriEncodedComponents = this.encodeURIComponents({name: name, vhost: vhost});
    return await this.request(`queues/${uriEncodedComponents.vhost}/${uriEncodedComponents.name}`, {method: 'delete'});
  }

  /**
   * Get messages from a queue.
   *
   * All options are mandatory except for options.truncate
   *
   * @param {string} queueName          - The name of the queue we wish to pull messages from
   * @param {Object} options            - Options required to fulfill the request
   * @param {number} options.count      - The amount of messages we wish to pull from the queue
   * @param {boolean} options.requeue   - If true, messages will remain in the queue
   * @param {string} options.encoding   - Must be either 'auto' or 'base64'
   *                                      Payload will be returned as a UTF-8 encoded string when 'auto'
   *                                      and base 64 encoded when 'base64'
   * @param {number} options.truncate   - If present, the payload will truncate after the specified amount of bytes
   * @param {string} vhost              - The virtual host where the queue resides
   *
   */
  async messagesFromQueue(queueName, options={count: 5, requeue: true, encoding:'auto', truncate: 50000}, vhost='/') {
    if (!this.queueNameExists(queueName)) {
      return;
    }
    const uriEncodedComponents = this.encodeURIComponents({queueName: queueName, vhost: vhost});
    return await this.request(`queues/${uriEncodedComponents.vhost}/${uriEncodedComponents.queueName}/get`, {
      body: JSON.stringify(options),
      method: 'post',
    });
  }
}

module.exports = RabbitManager;
