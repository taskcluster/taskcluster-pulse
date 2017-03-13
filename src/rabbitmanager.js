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
const _ = require('lodash');

/**
 * Wrapper class for RabbitMQ management HTTP API
 * @class RabbitManager
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

  /** @private */
  encode(raw) {
    // NOTE: must use `encodeURIComponent` as we are encoding query parameters.
    if (raw instanceof Array) {
      return _.map(raw, (value) => encodeURIComponent(value));
    }
    assert(typeof raw == 'string');
    return encodeURIComponent(raw);
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
   * @throws {Error}                    - Thrown when user already exists.
   *
   * @param {string} name               - Username.
   * @param {string} password           - The plaintext password.
   * @param {Array.<string>} tags       - A list of tags for the user. "administrator",
   *    "monitoring" and "management" have special meanings recognized by RabbitMQ.
   *     Other custom tags are also allowed. Tags cannot contain comma (',').
   */
  async createOrUpdateUser(name, password, tags) {
    assert(name);
    assert(password);
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
    assert(name);

    let response = await this.request(`users/${name}`, {
      method: 'delete',
    });
  }

 /**
  * Get a list of all users.
  *
  * @returns {Promise.<Array.<Object>>} An array of users.
  */
  async users() {
    return await this.request('users');
  }

  /**
   * Get a user.
   *
   * @param {string} username
   * @returns {Promise.<Object>} User info.
   */
  async user(username) {
    return await this.request(`users/${username}`);
  }

  /**
   * Get a list of all exchanges
   */
  async exchanges() {
    return await this.request('exchanges');
  }

  /**
   * Get a list of users who have ALL the specified tags.
   *
   * @param {Array.<string>} tags - A list of tags as the filtering criteria.
   */
  async usersWithAllTags(tags=[]) {
    assert(tags instanceof Array);

    let userList = await this.users();
    return this.filterUsersWithTags(userList, tags, _.difference, _.eq);
  }

  /**
   * Get a list of users who have ANY of the specified tags.
   *
   * @param {Array.<string>} tags - A list of tags as the filtering criteria.
   */
  async usersWithAnyTags(tags=[]) {
    assert(tags instanceof Array);

    let userList = await this.users();
    return this.filterUsersWithTags(userList, tags, _.intersection, _.gt);
  }

  /** @private */
  filterUsersWithTags(userList, tags, combiner, comparator) {
    return userList.filter(user => {
      const userListTokens = user.tags.split(',');
      return comparator(combiner(tags, userListTokens).length, 0);
    });
  }

  /**
   * Get an individual permission of a user in a virtual host, or a list of all
   * permissions of a user.
   *
   * A user has either no permission in a vhost or exactly one permission which
   * contains configure, write and read patterns.
   *
   * @param {string} user       - Username (required).
   * @param {string} vhost      - Virtual host (if specified, an object
   *     describing the user permission on the vhost will be returned; if
   *     unspecified, an array of such objects will be returned).
   */
  async userPermissions(user, vhost) {
    assert(user);

    user = this.encode(user);
    if (vhost) {
      vhost = this.encode(vhost);
      return await this.request(`permissions/${vhost}/${user}`);
    } else {
      return await this.request(`users/${user}/permissions`);
    }
  }

  /**
   * Set an individual permission of a user in a virtual host. All parameters are mandatory.
   *
   * If there is an existing permission for this user and vhost, it will be overwritten.
   *
   * @param {string} user       - Username.
   * @param {string} vhost      - Virtual host.
   * @param {string} configurePattern
   * @param {string} writePattern
   * @param {string} readPattern
   */
  async setUserPermissions(user, vhost, configurePattern, writePattern, readPattern) {
    assert(user);
    assert(vhost);
    assert(configurePattern);
    assert(writePattern);
    assert(readPattern);

    let permissions = {
      configure: configurePattern,
      write: writePattern,
      read: readPattern,
    };
    [user, vhost] = this.encode([user, vhost]);
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
    assert(user);
    assert(vhost);

    [user, vhost] = this.encode([user, vhost]);
    await this.request(`permissions/${vhost}/${user}`, {method: 'delete'});
  }

  /** Get a list of all queues. */
  async queues() {
    return await this.request('queues');
  }

  /**
   * Get information of an individual queue.
   *
   * @param {string} name       - Name of the queue.
   * @param {string} vhost      - Virtual host.
   * @default
   */
  async queue(name, vhost='/') {
    assert(name);
    assert(vhost);

    [name, vhost] = this.encode([name, vhost]);
    return await this.request(`queues/${vhost}/${name}`);
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
    assert(name);
    assert(options instanceof Object);
    assert(vhost);

    [name, vhost] = this.encode([name, vhost]);
    return await this.request(`queues/${vhost}/${name}`, {
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
    assert(name);
    assert(vhost);

    [name, vhost] = this.encode([name, vhost]);
    return await this.request(`queues/${vhost}/${name}`, {method: 'delete'});
  }

  /**
   * Get messages from a queue.
   *
   * @param {string} name               - The name of the queue we wish to pull messages from.
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
  async messagesFromQueue(name, options={count: 5, requeue: true, encoding:'auto', truncate: 50000}, vhost='/') {
    assert(name);
    assert(options instanceof Object);
    assert(options.count);
    assert(options.requeue);
    assert(options.encoding);
    assert(vhost);

    [name, vhost] = this.encode([name, vhost]);
    return await this.request(`queues/${vhost}/${name}/get`, {
      body: JSON.stringify(options),
      method: 'post',
    });
  }
}

module.exports = RabbitManager;
