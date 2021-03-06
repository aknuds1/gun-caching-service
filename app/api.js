const logger = require('@arve.knudsen/js-logger').get('service.api')
require('gun/lib/later')
require('gun/lib/path')
require('gun/lib/then')
const Promise = require('bluebird')
const TypedError = require('error/typed')
const grpc = require('grpc')
const isEmpty = require('ramda/src/isEmpty')
const t = require('tcomb')
const S = require('underscore.string.fp')

const badRequestError = TypedError({
  type: 'badRequestError',
  message: 'Bad Request',
  code: grpc.status.INVALID_ARGUMENT,
})

const generateKeys = (path) => {
  return [path[0], S.join('/', path.slice(1)),]
}

const ping = () => {
  logger.debug(`Received ping request`)
}

const getEntry = async ({gun, path,}) => {
  t.Array(path, ['path',])
  if (isEmpty(path)) {
    logger.debug(`Path should be an array`)
    throw badRequestError()
  }

  logger.debug(`Received getEntry request for path`, path)
  const [rootKey, itemKey,] = generateKeys(path)
  const envelope = await new Promise((resolve) => {
    gun.get(rootKey).get(itemKey).once(resolve)
  })
  if (envelope != null) {
    t.String(envelope.item, ['envelope', 'item',])
    t.Number(envelope.ttl, ['envelope', 'ttl',])
    t.Number(envelope.stored, ['envelope', 'stored',])
    return {
      item: envelope.item,
      ttl: envelope.ttl,
      stored: {
        seconds: envelope.stored / 1000,
      },
    }
  } else {
    return {}
  }
}

const setEntry = async ({gun, path, item, ttl,}) => {
  t.Array(path, ['path',])
  t.String(item, ['item',])
  t.Number(ttl, ['ttl',])
  if (isEmpty(path)) {
    logger.debug(`Path should be an array`)
    throw badRequestError()
  }

  logger.debug(`Received setEntry request for path`, path)
  const envelope = {
    item,
    stored: Date.now(),
    ttl,
  }
  const [rootKey, itemKey,] = generateKeys(path)
  await gun.get(rootKey).get(itemKey).put(envelope).later(() => {
    logger.debug(`Deleting envelope with key ${rootKey}.${itemKey}`)
    gun.get(rootKey).get(itemKey).put(null)
  }, ttl).then()
}

const deleteEntry = async ({gun, path,}) => {
  t.Array(path, ['path',])
  if (isEmpty(path)) {
    logger.debug(`Path should be an array`)
    throw badRequestError()
  }
  logger.debug(`Received deleteEntry request for path`, path)
  const [rootKey, itemKey,] = generateKeys(path)
  return await gun.get(rootKey).get(itemKey).put(null).then()
}

module.exports = {
  ping,
  getEntry,
  setEntry,
  deleteEntry,
}
