const fs = require('fs')
const path = require('path')
const Promise = require('bluebird')
const Client = require('bitcore-wallet-client').default
const sjcl = require('sjcl')

class BTCClient {
  constructor ({
    baseUrl,
    logLevel,
    timeout,
    credentialsDir
  }) {
    this.clients = {}
    this.baseUrl = baseUrl
    this.logLevel = logLevel
    this.timeout = timeout
    this.credentialsDir = credentialsDir
  }

  async listTrxs ({
    wallet,
    cursor,
    limit,
    untilTrxId
  }) {
    limit = limit || 100
    let pageLimit = limit
    let {
      nextTrxId,
      skip
    } = this._parseCursor(cursor)
    skip = skip || 0
    const client = await this._getWallet(wallet)
    let trxs = []
    while (true) {
      console.log(`skip: ${skip}, pageLimit:${pageLimit}`)
      let txPage = await client.getTxHistoryAsync({
        skip,
        limit: pageLimit + (nextTrxId ? 1 : 0),
        includeExtendedInfo: false
      })
      // console.log(JSON.stringify(txPage, null, 4))
      console.log(`txPage length: ${txPage.length} nextTrxId: ${nextTrxId}`)
      if (!txPage.length || (txPage.length === 1 && nextTrxId === txPage[0].txid)) {
        return {
          trxs
        }
      }
      skip += txPage.length - 1
      if (nextTrxId) {
        const trxPos = this._findTrx(txPage, nextTrxId)
        if (trxPos > -1) {
          txPage = txPage.slice(trxPos + 1)
          if (txPage.length) { nextTrxId = null }
        } else {
          txPage = []
        }
      }
      if (untilTrxId) {
        const trxPos = this._findTrx(txPage, untilTrxId)
        if (trxPos > -1) {
          txPage = txPage.slice(0, trxPos)
          return {
            trxs: trxs.concat(txPage)
          }
        }
      }
      trxs = trxs.concat(txPage)
      const leftToFetch = limit - trxs.length
      if (!nextTrxId) {
        nextTrxId = trxs[trxs.length - 1].txid
      }
      if (leftToFetch <= 0) {
        return {
          cursor: `${nextTrxId};${skip}`,
          trxs
        }
      }
      pageLimit = Math.min(pageLimit, leftToFetch)
    }
  }

  /**
   *
   * @param {Array} txs
   * @param {string} txId
   */
  _findTrx (txs, txId) {
    return txs.findIndex(tx => tx.txid === txId)
  }

  /**
   *
   * @param {string} cursor
   */
  _parseCursor (cursor) {
    cursor = cursor || ''
    const [nextTrxId, skip] = cursor.split(';')
    return {
      nextTrxId,
      skip: parseInt(skip)
    }
  }

  async _getWallet (wallet) {
    try {
      if (!this.clients[wallet]) {
        const client = this._createClient()
        const basePath = path.join(this.credentialsDir, wallet)
        let walletInfo = this._readFile(`${basePath}.json`)
        const password = this._readFile(`${basePath}.key`)
        walletInfo = sjcl.decrypt(password, walletInfo)
        walletInfo = JSON.parse(walletInfo)
        client.fromObj(walletInfo.credentials)
        this.clients[wallet] = client
        const walletStatus = await client.getStatusAsync({})
        console.log('Opening wallet: ', JSON.stringify(walletStatus, null, 4))
      }
      return this.clients[wallet]
    } catch (error) {
      console.error('Error getting wallet: ', error)
      delete this.clients[wallet]
      throw new Error('An error occurred while getting wallet, please make sure the wallet name is correct')
    }
  }

  _readFile (fileName) {
    return fs.readFileSync(fileName, {
      encoding: 'utf8'
    })
  }

  _createClient () {
    return Promise.promisifyAll(
      new Client({
        baseUrl: this.baseUrl,
        logLevel: this.logLevel,
        timeout: this.timeout
      }))
  }
}

module.exports = BTCClient
