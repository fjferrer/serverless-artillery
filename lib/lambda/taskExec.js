/* eslint-disable no-underscore-dangle */

const artillery = require('artillery-core')
const csv = require('csv-parse/lib/sync')
const fs = require('fs')
const path = require('path')

const def = require('./taskDef')

const impl = {
  /**
   * Loads custom processor functions from artillery configuration
   * @param script The Artillery (http://artillery.io) script to be executed
   */
  loadProcessor: (script) => {
    const config = script.config
    if (config.processor && typeof config.processor === 'string') {
      const processorPath = path.resolve(process.cwd(), config.processor)
      config.processor = require(processorPath) // eslint-disable-line global-require,import/no-dynamic-require
    }
  },
  /**
   * Reads the playload data from the test script.
   * @param script - Script that defines the payload to be read.
   */
  readPayload(script) {
    let ret
    const determinePayloadPath = payloadFile => path.resolve(process.cwd(), payloadFile)
    const readSinglePayload = (payloadObject) => {
      const payloadPath = determinePayloadPath(payloadObject.path)
      const data = fs.readFileSync(payloadPath, 'utf-8')
      const options = payloadObject.options || {}
      return csv(data, options)
    }
    if (script && script.config && script.config.payload) {
      // There's some kind of payload, so process it.
      if (Array.isArray(script.config.payload)) {
        ret = JSON.parse(JSON.stringify(script.config.payload))
        // Multiple payloads to load, loop through and load each.
        script.config.payload.forEach((payload, i) => {
          ret[i].data = readSinglePayload(payload)
        })
      } else if (typeof script.config.payload === 'object') {
        // Just load the one playload
        ret = readSinglePayload(script.config.payload)
      } else {
        console.log('WARNING: payload file not set, but payload is configured.\n')
      }
    }
    return ret
  },
  // event is bare Artillery script
  /**
   * Run a load test given an Artillery script and report the results
   * @param timeNow The time this task invocation began (serves as an id for the function)
   * @param script The artillery script to execution load from
   * @returns {Promise} Resolving to the load results report generated by Artillery
   */
  execLoad: (timeNow, script) => {
    let runner
    let payload
    let msg
    if (script._trace) {
      console.log(`runLoad started from ${script._genesis} @ ${timeNow}`)
    }
    if (script._simulation) {
      console.log(`SIMULATION: runLoad called with ${JSON.stringify(script, null, 2)}`)
      return Promise.resolve({ Payload: '{ "errors": 0 }' })
    } else {
      return new Promise((resolve, reject) => {
        try {
          impl.loadProcessor(script)
          payload = impl.readPayload(script)
          runner = artillery.runner(script, payload, {})
          runner.on('phaseStarted', (opts) => {
            console.log(`phase ${opts.index}${opts.name ? ` (${opts.name})` : ''} started, duration: ${opts.duration ? opts.duration : opts.pause}`)
          })
          runner.on('phaseCompleted', (opts) => {
            console.log('phase', opts.index, ':', opts.name ? opts.name : '', 'complete')
          })
          runner.on('done', (finalReport) => {
            const report = finalReport
            const latencies = report.latencies
            delete report.latencies
            console.log(JSON.stringify(report, null, 2))
            report.latencies = latencies
            resolve(report)
            if (script._trace) {
              console.log(`runLoad stopped from ${script._genesis} in ${timeNow} @ ${Date.now()}`)
            }
          })
          runner.run()
        } catch (ex) {
          msg = `ERROR exception encountered while executing load from ${script._genesis} in ${timeNow}: ${ex.message}\n${ex.stack}`
          console.log(msg)
          reject(new def.TaskError(msg))
        }
      })
    }
  },
}

module.exports = impl.execLoad

/* test-code */
module.exports.impl = impl
/* end-test-code */