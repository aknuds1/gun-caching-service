const grpc = require('grpc')
const Logger = require('@arve.knudsen/js-logger')
const logger = Logger.get('service')
const t = require('tcomb')
const path = require('path')
const pipe = require('ramda/src/pipe')
const {DateTime,} = require('luxon')
const toPairs = require('ramda/src/toPairs')
const map = require('ramda/src/map')
const fromPairs = require('ramda/src/fromPairs')
const TypedError = require('error/typed')
const forEach = require('ramda/src/forEach')
const assert = require('assert')

const getConfig = require('./getConfig')
const sendEmail = require('./sendEmail')
const api = require('./api')

const proto = grpc.load(path.join(__dirname, './protos/service.proto')).gunCachingService

Logger.useDefaults({
  formatter: (messages, context) => {
    messages.unshift(`${context.level.name} - [${context.name}]`)
  },
  defaultLevel: Logger.DEBUG,
})
Logger.setHandler((messages, context) => {
  Logger.getDefaultHandler()(messages, context)

  if (context.level === Logger.ERROR) {
    let reason = messages[0]
    let error = messages[1]
    let message
    if (error == null) {
      const stack = new Error().stack.replace(/\n/g, '<br>')
      message = `${reason}<br><br>

Traceback:
${stack}
`
    } else {
      const stack = error.stack != null ? error.stack : error
      message = stack.replace(/\n/g, '<br>')
    }

    let dateTimeStr = DateTime.utc().format('YYYY-MM-DD HH:mm:ss')
    sendEmail({
      subject: `Error Detected in Experimental Berlin Database Service`,
      html: `<p>${dateTimeStr} - an error was detected in Experimental Berlin Database Service</p>

<blockquote>
${message}
</blockquote>
`,
    })
      .catch((error) => {
        logger.warn(`Failed to notify of error via email: ${error}`)
      })
  }
})

const implementationError = TypedError({
  type: 'implementationError',
  message: 'Implementation Error',
  code: grpc.status.INTERNAL,
})

const callNonStreamingHandler = async (name, handler, callback, request) => {
  logger.debug(`Calling non-streaming handler for method ${name}`)
  let resp
  try {
    resp = await handler(request)
  } catch (error) {
    if (error.type == null) {
      logger.debug(`Handler threw an unexpected exception:`, error)
      error = implementationError({message: error.message,})
    } else {
      logger.debug(`Handler threw an expected exception: ${error}`)
    }
    if (error.data != null) {
      logger.debug(`Translating exception data into grpc metadata:`, error.data)
      error.metadata = new grpc.Metadata()
      forEach(([k, v,]) => {
        t.String(k, ['error', 'data',])
        t.String(v, ['error', 'data', k,])
        logger.debug(`Setting metadata ${k} => ${v}`)
        error.metadata.set(k, v)
      }, toPairs(error.data))

      logger.debug(`Generated grpc metadata:`, error.metadata.getMap())
    }
    callback(error)
    return
  }

  logger.debug(`Handler for method ${name} returned successfully`)
  callback(null, resp)
}

const wrapApi = () => {
  return pipe(
    toPairs,
    map(([name, handler,]) => {
      return [name, (call, callback) => {
        assert.equal(call.write, null)
        callNonStreamingHandler(name, handler, callback, call.request)
      },]
    }),
    fromPairs
  )(api)
}

const provision = async () => {
  logger.debug(`Starting server...`)
  const config = await getConfig()
  const wrappedApi = wrapApi()
  const server = new grpc.Server()
  server.addService(proto.GunCachingService.service, wrappedApi)
  server.bind(`0.0.0.0:${config.port}`, grpc.ServerCredentials.createSsl(
    Buffer.from(config.grpcTlsCa), [
      {private_key: Buffer.from(config.grpcTlsKey), cert_chain: Buffer.from(config.grpcTlsCert),},
  ], true))
  server.start()
  logger.info(`Server running at ${config.appUri}:${config.port}`)
}

provision()
  .catch((error) => {
    logger.error(`Failed to start server`, error)
    process.exit(1)
  })
