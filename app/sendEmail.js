const Promise = require('bluebird')
const mandrill = require('mandrill-api/mandrill')
const logger = require('@arve.knudsen/js-logger').get('sendEmail')

const getConfig = require('./getConfig')

module.exports = async ({subject, html,}) => {
  const config = await getConfig()
  const emailAddress = config.recipientEmailAddress
  logger.debug(`Reporting error by email to '${emailAddress}'...`)
  const mandrillClient = new mandrill.Mandrill(config.mandrillSecret)
  const message = {
    html,
    subject,
    from_email: config.senderEmailAddress,
    from_name: config.senderName,
    to: [{
      email: emailAddress,
      type: 'to',
    },],
    headers: {
      'Reply-To': config.replyEmailAddress,
    },
  }
  logger.debug(`Sending email to '${emailAddress}'...`)
  await new Promise((resolve, reject) => {
    mandrillClient.messages.send({
      message: message,
      async: true,
    }, () => {
      logger.debug(`Sent email to '${emailAddress}' successfully`)
      resolve()
    }, (error) => {
      logger.warn(
          `Unable to send email to '${emailAddress}', Mandrill error: '${error.message}'`)
      reject(`A Mandrill error occurred sending email to '${emailAddress}': '${error.message}'`)
    })
  })
}
