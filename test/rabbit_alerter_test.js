suite('Rabbit Alerter', () => {
  const assert = require('assert');
  const sinon = require('sinon');
  const _ = require('lodash');
  const helper = require('./helper');
  const RabbitMonitor = require('../lib/rabbitmonitor');

  const queueOne = 'one';
  const queueTwo = 'two';
  const taskClusterQueueOne = 'taskcluster/one';
  const taskClusterQueueTwo = 'taskcluster/two';

  const createStats = () => {
    const queueName = taskClusterQueueOne;
    const messages = 0;
    const rate = 0;
    return new RabbitMonitor.Stats(queueName, messages, rate);
  };

  const createEmptyNamespace = () => {
    return {
      contact: {
        method: '',
        payload: { },
      },
    };
  };

  test('messagesExceeded', () => {
    const stats = createStats();

    stats.messages = 20;
    assert(helper.alerter.messagesExceeded(stats));

    stats.messages = 10;
    assert(!helper.alerter.messagesExceeded(stats));
  });

  test('messagePublishRateExceeded', () => {
    const stats = createStats();

    stats.rate = 20;
    assert(helper.alerter.messagePublishRateExceeded(stats));

    stats.rate = 0;
    assert(!helper.alerter.messagePublishRateExceeded(stats));
  });

  test('createPulseAlert', () => {
    const stats = createStats();
    const namespace = createEmptyNamespace();

    namespace.contact.method = 'pulse';
    namespace.contact.payload.routingKey = 'rabbit-alerter-test';

    const pulseAlert = helper.alerter.createAlert(stats, namespace);
    assert(_.has(pulseAlert, 'payload'));
    assert(_.has(pulseAlert.payload, 'routingKey'));
    assert(_.has(pulseAlert.payload, 'message'));
  });

  test('createEmailAlert', () => {
    const stats = createStats();
    const namespace = createEmptyNamespace();

    namespace.contact.method = 'email';
    namespace.contact.payload.address = 'alert@pulsetests.com';

    const emailAlert = helper.alerter.createAlert(stats, namespace);
    assert(_.has(emailAlert, 'payload'));
    assert(_.has(emailAlert.payload, 'address'));
    assert(_.has(emailAlert.payload, 'subject'));
    assert(_.has(emailAlert.payload, 'content'));
    assert(!_.has(emailAlert.payload, 'message'));
  });

  test('createIRCAlert', () => {
    const stats = createStats();
    const namespace = createEmptyNamespace();

    namespace.contact.method = 'irc';
    namespace.contact.payload.channel = '#taskcluster-test';

    const pulseAlert = helper.alerter.createAlert(stats, namespace);
    assert(_.has(pulseAlert, 'payload'));
    assert(_.has(pulseAlert.payload, 'channel'));
    assert(_.has(pulseAlert.payload, 'message'));
  });

  test('sendAlert', async () => {
    const mockNotifier = {
      pulse: sinon.spy(),
      email: sinon.spy(),
      irc: sinon.spy(),
    };
    helper.alerter.notifier = mockNotifier;

    const stats = createStats();
    const namespace = createEmptyNamespace();

    namespace.contact.method = 'pulse';
    helper.alerter.sendAlert(stats, namespace);
    assert(mockNotifier.pulse.calledOnce);

    namespace.contact.method = 'email';
    helper.alerter.sendAlert(stats, namespace);
    assert(mockNotifier.email.calledOnce);

    namespace.contact.method = 'irc';
    helper.alerter.sendAlert(stats, namespace);
    assert(mockNotifier.irc.calledOnce);
  });
});
