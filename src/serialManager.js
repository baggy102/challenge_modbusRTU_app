const { SerialPort } = require('serialport')
const { InterByteTimeoutParser } = require('@serialport/parser-inter-byte-timeout')

class SerialManager {
  constructor () {
    this.port = null
    this.parser = null
    this.pollInterval = null
    this.statusCb = null
    this.logCb = null
    this.queue = []
    this.processing = false
    this.slaveId = 1

    this._cmdQueue   = []
    this._cmdRunning = false
    this._portName   = null
    this._baudRate   = 115200
    this._reconnecting = false
  }

  log (message) {
    console.log('[SerialManager]', message)
    if (this.logCb) this.logCb(message)
  }

  onStatus (callback) { this.statusCb = callback }
  onLog (callback) { this.logCb = callback }

  async connect (portName, baudRate = 115200) {
    if (this.port && this.port.isOpen) await this.disconnect()

    this._portName = portName
    this._baudRate = baudRate

    this.port   = new SerialPort({ path: portName, baudRate: Number(baudRate), autoOpen: false })
    this.parser = this.port.pipe(new InterByteTimeoutParser({ interval: 30 }))

    return new Promise((resolve, reject) => {
      this.port.open((error) => {
        if (error) return reject(error)

        this.port.on('close', () => this._onPortClose())
        this.port.on('error', (error) => this.log('Port error: ' + error))

        this.startPolling()
        this.log(`Opened ${portName}@${baudRate}`)
        resolve()
      })
    })
  }

  async disconnect () {
    this.stopPolling()
    if (!this.port) return
    // close 이벤트가 재연결 루프를 트리거하지 않도록 리스너 제거
    this.port.removeAllListeners('close')
    return new Promise((resolve) => {
      this.port.close(() => {
        this.log('Port closed')
        this.port   = null
        this.parser = null
        resolve()
      })
    })
  }

  _onPortClose () {
    if (this._reconnecting) return
    this._reconnecting = true
    this.log('Connection lost. Attempting to reconnect...')

    this.stopPolling()

    // 포트가 아직 열려있으면 닫기 (무응답 케이스)
    if (this.port && this.port.isOpen) {
      this.port.removeAllListeners('close')
      this.port.close(() => {})
    }
    this.port   = null
    this.parser = null

    // 대기 중인 프레임 요청 전부 즉시 실패 처리
    for (const { reject } of this._cmdQueue) reject(new Error('Disconnected'))
    this._cmdQueue   = []
    this._cmdRunning = false

    this._reconnectLoop()
  }

  async _reconnectLoop () {
    for (let attempt = 1; ; attempt++) {
      this.log(`Reconnect attempt ${attempt}...`)
      await this._waitFor(2000)
      try {
        await this.connect(this._portName, this._baudRate)
        this.log('Reconnected successfully')
        this._reconnecting = false
        return
      } catch (error) {
        this.log(`Reconnect ${attempt} failed: ${error.message}`)
      }
    }
  }

  _writeAndRead (frame, timeout = 1000) {
    return new Promise((resolve, reject) => {
      if (this._reconnecting) {
        reject(new Error('Reconnecting'))
        return
      }
      this._cmdQueue.push({ frame, timeout, resolve, reject })
      this._runNext()
    })
  }

  _runNext () {
    if (this._cmdRunning || this._cmdQueue.length === 0 || this._reconnecting) return
    this._cmdRunning = true

    const { frame, timeout, resolve, reject } = this._cmdQueue.shift()

    if (!this.port || !this.port.isOpen) {
      this._cmdRunning = false
      reject(new Error('Port not open'))
      this._runNext()
      return
    }

    const onData = (data) => {
      clearTimeout(timer)
      this._cmdRunning = false
      resolve(data)
      this._runNext()
    }

    const timer = setTimeout(() => {
      this.parser.removeListener('data', onData)
      this._cmdRunning = false
      this.log('Timeout - triggering reconnect')
      reject(new Error('Timeout'))
      this._onPortClose()
    }, timeout)

    this.parser.once('data', onData)

    this.port.write(frame, (error) => {
      if (!error) { this.port.drain(() => {}); return }
      clearTimeout(timer)
      this.parser.removeListener('data', onData)
      this._cmdRunning = false
      reject(error)
      this._runNext()
    })
  }

  crc16 (buffer) {
    let crc = 0xFFFF
    for (let position = 0; position < buffer.length; position++) {
      crc ^= buffer[position]
      for (let i = 0; i < 8; i++) {
        if ((crc & 0x0001) !== 0) { crc >>= 1; crc ^= 0xA001 } else crc >>= 1
      }
    }
    return crc
  }

  // 프레임 구조
  // [슬레이브주소][기능코드][데이터...][CRC16 (2바이트, little-endian)]
  _buildFrame (functionCode, address, registerData) {
    const buf = Buffer.alloc(6)
    buf[0] = this.slaveId
    buf[1] = functionCode
    buf[2] = (address >> 8) & 0xFF
    buf[3] = address & 0xFF
    buf[4] = (registerData >> 8) & 0xFF
    buf[5] = registerData & 0xFF
    const crc = this.crc16(buf)
    return Buffer.concat([buf, Buffer.from([crc & 0xFF, (crc >> 8) & 0xFF])])
  }

  _parseRegs (response) {
    if (response[1] & 0x80) throw new Error('Exception ' + response[2])
    const values = []
    for (let i = 0; i < response[2] / 2; i++) values.push((response[3 + i * 2] << 8) | response[4 + i * 2])
    return values
  }

  async _readRegs (functionCode, address, quantity) {
    const response = await this._writeAndRead(this._buildFrame(functionCode, address, quantity), 800)
    return this._parseRegs(response)
  }

  async readInputRegisters (address, quantity = 1) {
    try {
      return await this._readRegs(0x04, address, quantity)
    } catch (error) {
      this.log('readInputRegisters error: ' + error)
      throw error
    }
  }

  async writeSingleRegister (address, value) {
    try {
      const response = await this._writeAndRead(this._buildFrame(0x06, address, value), 800)
      if (response[1] & 0x80) throw new Error('Exception ' + response[2])
      return true
    } catch (error) {
      this.log('writeSingleRegister error: ' + error)
      throw error
    }
  }

  async _readHolding (address, quantity = 1) {
    return this._readRegs(0x03, address, quantity)
  }

  startPolling () {
    if (this.pollInterval) return
    let busy = false
    this.pollInterval = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const block0 = await this.readInputRegisters(0x0000, 4)
        const block1 = await this.readInputRegisters(0x0020, 4)
        const stage  = await this.readInputRegisters(0x0030, 1)
        const rcp    = await this.readInputRegisters(0x0090, 1)
        if (this.statusCb) this.statusCb({
          sysMode:  block0[0],
          cmdReady: block0[2],
          cup:      block0[3],
          boiler:   block1[0] / 100.0,
          pressure: block1[3] / 100.0,
          stage:    stage[0],
          rcpState: rcp[0],
        })
      } catch (error) {
        if (this.statusCb) this.statusCb({ error: String(error) })
      } finally {
        busy = false
      }
    }, 100)
  }

  stopPolling () {
    if (this.pollInterval) clearInterval(this.pollInterval)
    this.pollInterval = null
  }

  addOrders (order) {
    for (let i = 0; i < (order.count || 1); i++) this.queue.push({ dose: order.dose, yield: order.yield })
    this.log(`Queue length: ${this.queue.length}`)
  }

  async startQueue () {
    if (this.processing) return
    this.processing = true
    while (this.queue.length > 0) {
      const job = this.queue.shift()
      try {
        await this._processJob(job)
      } catch (error) {
        this.log('Job error: ' + error)
      }
    }
    this.processing = false
  }

  async _processJob (job) {
    this.log('Starting job ' + JSON.stringify(job))
    const doseVal  = Math.round(job.dose * 10)
    const yieldVal = Math.round(job.yield * 10)

    await this.writeSingleRegister(0x0120, doseVal)
    await this.writeSingleRegister(0x0121, yieldVal)

    for (let attempt = 0; attempt < 20; attempt++) {
      const ready = (await this.readInputRegisters(0x0002, 1))[0]
      if ((ready & 0x0001) === 1) break
      await this._waitFor(200)
    }

    await this.writeSingleRegister(0x0001, 0)
    await this.writeSingleRegister(0x0002, 0)
    await this.writeSingleRegister(0x0000, 0x0005)

    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const hr0 = await this._readHolding(0x0000, 1)
        if (hr0[0] === 0x0000) { this.log('Command accepted'); break }
        if (hr0[0] === 0xFFFF) { this.log('Command rejected by device'); throw new Error('Command rejected') }
      } catch (error) {
        this.log('read holding error: ' + error)
      }
      await this._waitFor(200)
    }

    let completed = false
    for (let t = 0; t < 600; t++) {
      const r = (await this.readInputRegisters(0x0090, 1))[0]
      if (r === 2) {
        for (let k = 0; k < 200; k++) {
          const cup = (await this.readInputRegisters(0x0003, 1))[0]
          if (cup === 0x0000) { completed = true; break }
          await this._waitFor(200)
        }
        break
      }
      await this._waitFor(200)
    }

    if (completed) this.log('Job completed successfully')
    else this.log('Job did not complete properly')
  }

  _waitFor (milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }
}

module.exports = SerialManager
