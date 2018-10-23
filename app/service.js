const grpc = require('grpc')
const protoLoader = require('@grpc/proto-loader')
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
const http = require('http')
const Gun = require('gun')
const dns = require('dns')
const Promise = require('bluebird')
const merge = require('ramda/src/merge')
const os = require('os')
const filter = require('ramda/src/filter')
const {isNullOrBlank,} = require('@arve.knudsen/stringutils')

const getConfig = require('./getConfig')
const sendEmail = require('./sendEmail')
const api = require('./api')

Logger.useDefaults({
  formatter: (messages, context) => {
    messages.unshift(`${context.level.name} - [${context.name}]`)
  },
  defaultLevel: process.env.APP_ENVIRONMENT === 'production' ? Logger.INFO : Logger.DEBUG,
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

const callNonStreamingHandler = async (name, handler, callback, request, gun) => {
  t.Object(gun, ['gun',])
  logger.debug(`Calling non-streaming handler for method ${name}`)
  let resp
  try {
    resp = await handler(merge(request, {gun,}))
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

const wrapApi = (gun) => {
  t.Object(gun, ['gun',])
  return pipe(
    toPairs,
    map(([name, handler,]) => {
      return [name, (call, callback) => {
        assert.equal(call.write, null)
        callNonStreamingHandler(name, handler, callback, call.request, gun)
      },]
    }),
    fromPairs
  )(api)
}

const discoverPeers = async () => {
  let peers
  try {
    peers = await Promise.promisify(dns.lookup)('gun-caching-service-peer-discovery', {all: true,})
  } catch (error) {
    logger.debug(`Couldn't detect any peers due to error: ${error.message}`)
    return []
  }

  const hostname = os.hostname()
  assert.ok(!isNullOrBlank(hostname))
  const ownIp = await Promise.promisify(dns.lookup)(hostname)
  t.String(ownIp, ['ownIp',])
  assert.ok(!isNullOrBlank(ownIp))
  return map((peer) => {
    return `http://${peer.address}:9001`
  }, filter((peer) => {
    return peer.address !== ownIp
  }, peers))
}

const provision = async () => {
  logger.debug(`Starting service...`)
  const config = await getConfig()

  const pkgDef = await protoLoader.load(path.join(__dirname, './protos/service.proto'))
  const {GunCachingService,} = grpc.loadPackageDefinition(pkgDef).gunCachingService

  const peers = await discoverPeers()
  t.Array(peers, ['peers',])
  logger.debug(`Connecting to GUN peers`, peers)
  const gunServer = http.createServer()
  gunServer.listen(9001)
  logger.info(`GUN database server running at ${config.appUri}:9001`)
  const gun = Gun({
    localStorage: false,
    file: config.databaseFile,
    web: gunServer,
    peers,
  })
  gun.get('catbox').on(() => {
    logger.debug(`Incoming changes`)
  })

  const wrappedApi = wrapApi(gun)
  const server = new grpc.Server()
  server.addService(GunCachingService.service, wrappedApi)
  server.bind(`0.0.0.0:${config.port}`, grpc.ServerCredentials.createSsl(
    Buffer.from(config.grpcTlsCa), [
      {private_key: Buffer.from(config.grpcTlsKey), cert_chain: Buffer.from(config.grpcTlsCert),},
  ], true))
  server.start()
  logger.info(`Service available at ${config.appUri}:${config.port}`)
}

provision()
  .catch((error) => {
    logger.error(`Failed to start server`, error)
    process.exit(1)
  })
