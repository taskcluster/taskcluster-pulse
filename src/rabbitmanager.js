/**
 * An interface to interacting with rabbitmq management api.
 *
 * Eventually, this can be broken out into its own package
 * if we find that it is sufficiently useful and generic.
 * With that in mind, this should not have any taskcluster-pulse
 * specific logic in it.
 *
 * @module rabbitmanager
 */

const assert = require('assert');
const rp = require('request-promise');
const slugid = require('slugid');
const _ = require('lodash');

/**
 * Wrapper class for RabbitMQ management HTTP API
 * @class
 */
class RabbitManager {
  /**
   * @param {Object} config
   * @param {string} config.username
   * @param {string} config.password
   * @param {string} config.baseUrl - The base URL of the management API, usually "<DASHBOARD URL>/api/".
   */
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

  /** @private */
  request(endpoint, optionsOverride = {}) {
    optionsOverride['uri'] = endpoint;
    let options = Object.assign({}, this.options, optionsOverride);
    return rp(options);
  }

  /** Get information that describe the whole system. */
  async overview() {
    return await this.request('overview');
  }

  /** Get the name identifying this RabbitMQ cluster. */
  async clusterName() {
    return await this.request('cluster-name');
  }

  /**
   * Create a user. All parameters are mandatory.
   *
   * @param {string} name               - Username.
   * @param {string} password           - The plaintext password.
   * @param {Array.<string>} tags       - A list of tags for the user. "administrator",
   *     "monitoring" and "management" have special meanings recognized by RabbitMQ.
   *     Other custom tags are also allowed. Tags cannot contain comma (',').
   */
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

  /**
   * Delete a user.
   *
   * @param {string} name - Username.
   */
  async deleteUser(name) {
    let response = await this.request(`users/${name}`, {
      method: 'delete',
    });
  }

  /** Get a list of all users. */
  async users() {
    return await this.request('users');
  }

  /**
   * Get a list of users who have ALL the specified tags.
   *
   * @param {Array.<string>} tags - A list of tags as the filtering criteria.
   */
  async usersWithAllTags(tags=[]) {
    let userList = await this.users();
    return this._filterUsersWithTags(userList, tags, _.difference, _.eq);
  }

  /**
   * Get a list of users who have ANY of the specified tags.
   *
   * @param {Array.<string>} tags - A list of tags as the filtering criteria.
   */
  async usersWithAnyTags(tags=[]) {
    let userList = await this.users();
    return this._filterUsersWithTags(userList, tags, _.intersection, _.gt);
  }

  /** @prviate */
  _filterUsersWithTags(userList, tags, combiner, comparator) {
    return userList.filter(user => {
      const userListTokens = user.tags.split(',');
      return comparator(combiner(tags, userListTokens).length, 0);
    });
  }

  /**
   * Get an individual permission of a user in a virtual host.
   *
   * @param {string} user       - Username.
   * @param {string} vhost      - Virtual host.
   * @default
   */
  async userPermissions(user, vhost='/') {
    vhost = encodeURIComponent(vhost);
    return await this.request(`permissions/${vhost}/${user}`);
  }

  /**
   * Set an individual permission of a user in a virtual host. All parameters are mandatory.
   *
   * @param {string} user       - Username.
   * @param {string} vhost      - Virtual host.
   * @param {string} configurePattern
   * @param {string} writePattern
   * @param {string} readPattern
   */
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

  /**
   * Delete an individual permission of a user in a virtual host.
   *
   * @param {string} user       - Username.
   * @param {string} vhost      - Virtual host.
   * @default
   */
  async deleteUserPermissions(user, vhost='/') {
    vhost = encodeURIComponent(vhost);
    await this.request(`permissions/${vhost}/${user}`, {method: 'delete'});
  }

  /** Get a list of all queues. */
  async queues() {
    return await this.request('queues');
  }

  /** @private */
  queueNameExists(name) {
    if (!name) {
      console.warn('Please provide a name for the queue!');
      return false;
    }
    return true;
  }

  /** @private */
  encodeURIComponents(components) {
    const result = {};
    Object.keys(components).forEach(key => result[key] = encodeURIComponent(components[key]));
    return result;
  }

  /**
   * Get information of an individual queue.
   *
   * @param {string} name       - Name of the queue.
   * @param {string} vhost      - Virtual host.
   * @default
   */
  async queue(name, vhost='/') {
    if (!this.queueNameExists(name)) {
      return;
    }
    const uriEncodedComponents = this.encodeURIComponents({name: name, vhost: vhost});
    return await this.request(`queues/${uriEncodedComponents.vhost}/${uriEncodedComponents.name}`);
  }

  /**
   * Create a queue.
   *
   * @param {string} name       - Name of the queue.
   * @param {Object} options    - Settings of the queue (default is {}; all keys are optional).
   *     See RabbitMQ documents for details.
   * @param {boolean} options.auto_delete
   * @param {boolean} options.durable
   * @param {Object} options.arguments
   * @param {string} options.node
   * @param {string} vhost      - Virtual host (default is "/").
   */
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

  /**
   * Delete a queue.
   *
   * @param {string} name       - Name of the queue.
   * @param {string} vhost      - Virtual host.
   * @default
   */
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
   * @param {string} queueName          - The name of the queue we wish to pull messages from.
   * @param {Object} options            - Options required to fulfill the request.
   *     All keys are mandatory except for options.truncate.
   * @param {number} options.count      - The amount of messages we wish to pull from the queue.
   * @param {boolean} options.requeue   - If true, messages will remain in the queue.
   * @param {string} options.encoding   - Must be either 'auto' or 'base64'.
   *     'auto': payload will be returned as a string if it is valid UTF-8, and base64 encoded otherwise.
   *     'base64': payload will always be base64 encoded.
   * @param {number} options.truncate   - If present, the payload will be truncated after
   *     the specified amount of bytes.
   * @param {string} vhost              - The virtual host where the queue resides (default is "/").
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
