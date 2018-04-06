const Promise = require('bluebird')
const fs = require('fs')
const logger = require('@arve.knudsen/js-logger').get('service.getConfig')

const getEnvParam = (name, dflt) => {
  const value = process.env[name]
  if (value == null) {
    if (dflt !== undefined) {
      return dflt
    } else {
      throw new Error(`Environment variable '${name}' not defined`)
    }
  } else {
    return value
  }
}

const getTlsFile = async (envVar, filePath) => {
  const tlsContentB64 = getEnvParam(envVar, null)
  if (tlsContentB64 != null) {
    logger.debug(`Reading certificate from environment variable ${envVar}`)
    return Buffer.from(tlsContentB64, 'base64').toString()
  } else {
    logger.debug(`Reading certificate from file ${filePath}`)
    return await Promise.promisify(fs.readFile)(filePath)
  }
}

let config
module.exports = async () => {
  if (config != null) {
    return config
  } else {
    logger.debug(`Reading configuration`)
    config = {
      appUri: getEnvParam('APP_URI', 'http://localhost'),
      senderEmailAddress: getEnvParam('SENDER_EMAIL_ADDRESS'),
      senderName: getEnvParam('SENDER_NAME'),
      recipientEmailAddress: getEnvParam('RECIPIENT_EMAIL_ADDRESS'),
      replyEmailAddress: getEnvParam('REPLY_EMAIL_ADDRESS'),
      port: parseInt(getEnvParam('PORT', '9000')),
      mandrillSecret: getEnvParam('MANDRILL_SECRET'),
      databaseFile: getEnvParam('DATABASE_FILE', 'radata'),
      grpcTlsKey: await getTlsFile('GRPC_TLS_KEY', '/etc/tls/gun-caching-service.server.key'),
      grpcTlsCert: await getTlsFile('GRPC_TLS_CERT', '/etc/tls/gun-caching-service.server.crt'),
      grpcTlsCa: await getTlsFile('GRPC_TLS_CA', '/etc/tls/gun-caching-service.ca.crt'),
    }
    logger.debug(`Using port ${config.port}`)
    return config
  }
}
