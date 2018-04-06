const logger = require('@arve.knudsen/js-logger').get('service.api')
const Gun = require('gun')
require('gun/lib/later')
const forEach = require('ramda/src/forEach')
const Promise = require('bluebird')
const TypedError = require('error/typed')
const grpc = require('grpc')
const isEmpty = require('ramda/src/isEmpty')
const t = require('tcomb')

const getConfig = require('./getConfig')

const TTL = 60

const badRequestError = TypedError({
  type: 'badRequestError',
  message: 'Bad Request',
  code: grpc.status.INVALID_ARGUMENT,
})

const getGun = async () => {
  const config = await getConfig()
  return Gun({
    localStorage: false,
    file: config.databaseFile,
  })
}

const ping = () => {
  logger.debug(`Received ping request`)
}

const getEntry = async ({path,}) => {
  t.Array(path, ['path',])
  if (isEmpty(path)) {
    logger.debug(`Path should be an array`)
    throw badRequestError()
  }
  logger.debug(`Received getEntry request for path`, path)
  const gun = await getGun()
  let obj = gun
  forEach((name) => {
    obj = obj.get(name)
  }, path)
  const envelope = await new Promise((resolve) => {
    obj.once(resolve)
  })
  return envelope != null ? {value: envelope.item,} : {}
}

const setEntry = async ({path, value,}) => {
  t.Array(path, ['path',])
  t.String(value, ['value',])
  if (isEmpty(path)) {
    logger.debug(`Path should be an array`)
    throw badRequestError()
  }
  logger.debug(`Received setEntry request for path`, path)
  const gun = await getGun()
  let gunContext = gun
  forEach((name) => {
    gunContext = gunContext.get(name)
  }, path)
  const envelope = {
    item: value,
    stored: Date.now(),
  }
  logger.debug(`Storing envelope`, envelope)
  await new Promise((resolve) => {
    gunContext.put(envelope, resolve).later((data, k) => {
      gunContext.get(k).put(null)
    }, TTL)
  })
}

const deleteEntry = async ({path,}) => {
  t.Array(path, ['path',])
  if (isEmpty(path)) {
    logger.debug(`Path should be an array`)
    throw badRequestError()
  }
  logger.debug(`Received deleteEntry request for path`, path)
  const gun = await getGun()
  let gunContext = gun
  forEach((name) => {
    gunContext = gunContext.get(name)
  }, path)
  gunContext.put(null)
}

module.exports = {
  ping,
  getEntry,
  setEntry,
  deleteEntry,
}
