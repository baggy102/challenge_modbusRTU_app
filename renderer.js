const dom = { id: id => document.getElementById(id) }

const mcu = window.api

const RECIPES = {
  espresso: { name: '에스프레소', dose: 15, yield: 30 },
}

// BRW_STAGE 값 → 버블 인덱스 (0-4), -1 = 유휴
// 시뮬레이터 단계: 1그라인딩 2레벨링 3리드닫힘 4탬핑 5추출 6퍽드라이 7리드열림 8와이프 9복귀
const STAGE_MAP = {
  0: -1,
  1: 0, 2: 0,
  3: 1, 4: 1,
  5: 2,
  6: 3, 7: 3, 8: 3,
  9: 4,
}

const STAGE_DETAIL = {
  1: '그라인딩',
  2: '레벨링',
  3: '리드 닫힘',
  4: '탬핑',
  5: '추출 중',
  6: '퍽 드라이',
  7: '리드 열림',
  8: '와이프',
  9: '복귀 중',
}

const state = {
  connected: false,
  selectedRecipe: 'espresso',
  count: 1,
  queue: [],
  currentRecipeName: '',
  prevRcpState: 0,
  brewCompleted: false,
  doneTimer: null,
}

// ─── 화면 전환 ───
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  dom.id('screen-' + name).classList.add('active')
}

// ─── 로그 ───
function log(txt) {
  const out = dom.id('log-output')
  out.textContent += '[' + new Date().toISOString().slice(11, 23) + '] ' + txt + '\n'
  out.scrollTop = out.scrollHeight
}

// ══════════════════════════════════════════
// Screen 1: 자동 연결 스플래시
// ══════════════════════════════════════════
const DEFAULT_PORT = 'COM7'
const DEFAULT_BAUD = 115200

async function autoConnect(port, baud) {
  dom.id('connect-status').textContent = port + ' 에 연결하는 중...'
  dom.id('retry-btn').style.display = 'none'
  const r = await mcu.connect(port, baud)
  if (r.ok) {
    state.connected = true
    log('Connected to ' + port)
    showScreen('menu')
  } else {
    dom.id('connect-status').textContent = '연결 실패: ' + (r.error || '알 수 없는 오류')
    dom.id('retry-btn').style.display = 'block'
    log('Connect failed: ' + r.error)
  }
}

dom.id('retry-btn').addEventListener('click', () => {
  const port = dom.id('port-input')?.value?.trim() || DEFAULT_PORT
  const baud = Number(dom.id('baud-input')?.value) || DEFAULT_BAUD
  autoConnect(port, baud)
})

// 앱 시작 시 자동 연결
autoConnect(DEFAULT_PORT, DEFAULT_BAUD)

// ══════════════════════════════════════════
// Screen 2: 메뉴 선택 화면
// ══════════════════════════════════════════
function openModal(recipeKey) {
  const r = RECIPES[recipeKey]
  state.selectedRecipe = recipeKey
  state.count = 1
  dom.id('modal-recipe-name').textContent   = r.name
  dom.id('modal-recipe-detail').textContent = '원두 ' + r.dose + 'g / 추출 ' + r.yield + 'ml'
  dom.id('modal-count-display').textContent = 1
  dom.id('order-modal').classList.remove('hidden')
}

function closeModal() {
  dom.id('order-modal').classList.add('hidden')
}

document.querySelectorAll('.recipe-card[data-recipe]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.recipe))
})

dom.id('debug-btn').addEventListener('click', () => showScreen('debug'))
dom.id('go-brewing-btn').addEventListener('click', () => showScreen('brewing'))

// ── 모달 수량 조절 ──
dom.id('modal-count-dec').addEventListener('click', () => {
  if (state.count > 1) { state.count--; dom.id('modal-count-display').textContent = state.count }
})

dom.id('modal-count-inc').addEventListener('click', () => {
  if (state.count < 9) { state.count++; dom.id('modal-count-display').textContent = state.count }
})

dom.id('modal-cancel-btn').addEventListener('click', closeModal)

dom.id('modal-ok-btn').addEventListener('click', async () => {
  closeModal()
  const r = RECIPES[state.selectedRecipe]
  const wasEmpty = state.queue.length === 0
  for (let i = 0; i < state.count; i++) {
    state.queue.push({ name: r.name, dose: r.dose, yield: r.yield })
  }
  log('주문 추가: ' + r.name + ' x' + state.count)
  updateQueuePanel()
  updateMenuFooter()
  if (wasEmpty) {
    await mcu.addOrder(r.dose, r.yield, 1)
    await mcu.startQueue()
    dom.id('brewing-recipe-name').textContent = r.name
    showScreen('brewing')
  }
})

// ══════════════════════════════════════════
// Screen 4: 제조 화면
// ══════════════════════════════════════════
dom.id('add-order-btn').addEventListener('click', () => showScreen('menu'))

function updateQueuePanel() {
  const ol    = dom.id('queue-list')
  const empty = dom.id('queue-empty-msg')
  const waiting = state.queue.slice(1)
  ol.innerHTML = ''
  if (waiting.length === 0) {
    ol.style.display = 'none'
    empty.style.display = 'flex'
  } else {
    ol.style.display = 'flex'
    empty.style.display = 'none'
    waiting.forEach((item, i) => {
      const li = document.createElement('li')
      li.textContent = (i + 1) + '. ' + item.name + ' (' + item.dose + 'g/' + item.yield + 'ml)'
      ol.appendChild(li)
    })
  }
}

function updateMenuFooter() {
  const total = state.queue.length
  if (total === 0) {
    dom.id('footer-queue').textContent = '대기 중인 주문이 없습니다'
    dom.id('go-brewing-btn').style.display = 'none'
  } else {
    dom.id('footer-queue').textContent = '대기: ' + total + '잔'
    dom.id('go-brewing-btn').style.display = 'inline-block'
  }
}

// 다음 잔 자동 시작
async function startNextBrew() {
  const next = state.queue[0]
  if (!next) return
  dom.id('brewing-recipe-name').textContent = next.name
  updateQueuePanel()
  showScreen('brewing')
  await mcu.addOrder(next.dose, next.yield, 1)
  await mcu.startQueue()
}

// ══════════════════════════════════════════
// Screen 5: 완료 화면
// ══════════════════════════════════════════
function showDoneScreen(recipeName) {
  dom.id('done-recipe-text').textContent = recipeName + ' 에스프레소'
  showScreen('done')

  let sec = 3
  dom.id('done-countdown').textContent = sec + '초 후 처음으로 돌아갑니다'
  if (state.doneTimer) clearInterval(state.doneTimer)
  state.doneTimer = setInterval(() => {
    sec--
    if (sec <= 0) {
      clearInterval(state.doneTimer)
      state.doneTimer = null
      showScreen(state.queue.length > 0 ? 'brewing' : 'menu')
    } else {
      dom.id('done-countdown').textContent = sec + '초 후 처음으로 돌아갑니다'
    }
  }, 1000)
}

dom.id('done-home-btn').addEventListener('click', () => {
  if (state.doneTimer) { clearInterval(state.doneTimer); state.doneTimer = null }
  showScreen('menu')
})

// ══════════════════════════════════════════
// Screen 6: 디버그 화면
// ══════════════════════════════════════════
dom.id('debug-back-btn').addEventListener('click', () => {
  showScreen(state.connected ? 'menu' : 'connect')
})

dom.id('disconnect-btn').addEventListener('click', async () => {
  await mcu.disconnect()
  state.connected = false
  state.queue = []
  if (state.doneTimer) { clearInterval(state.doneTimer); state.doneTimer = null }
  log('Disconnected')
  dom.id('connect-status').textContent = '연결이 해제되었습니다'
  dom.id('retry-btn').style.display = 'block'
  showScreen('connect')
})

dom.id('reconnect-btn').addEventListener('click', async () => {
  const port = dom.id('port-input').value.trim() || DEFAULT_PORT
  const baud = Number(dom.id('baud-input').value) || DEFAULT_BAUD
  if (state.connected) await mcu.disconnect()
  state.connected = false
  showScreen('connect')
  autoConnect(port, baud)
})

dom.id('add-order-debug').addEventListener('click', async () => {
  const dose    = Number(dom.id('dose').value)
  const yieldMl = Number(dom.id('yield-ml').value)
  const count   = Number(dom.id('manual-count').value)
  await mcu.addOrder(dose, yieldMl, count)
  for (let i = 0; i < count; i++) {
    state.queue.push({ name: 'Manual', dose, yield: yieldMl })
  }
  log('Added ' + count + ' order(s) manually')
})

dom.id('start-queue-debug').addEventListener('click', async () => {
  await mcu.startQueue()
  log('Queue started')
})

// ══════════════════════════════════════════
// 실시간 상태 업데이트
// ══════════════════════════════════════════
mcu.onStatus((s) => {
  if (s.error) { log('Status error: ' + s.error); return }

  const tempText  = s.boiler.toFixed(1) + ' °C'
  const tempClass = 'status-chip ' + (s.boiler >= 85 ? 'ok' : 'warn')
  const pressText = s.pressure.toFixed(2) + ' bar'
  const cupText   = s.cup !== 0 ? '컵 있음' : '컵 없음'
  const cupClass  = 'status-chip ' + (s.cup !== 0 ? 'ok' : '')
  const ready     = (s.cmdReady & 0x01) === 1 && s.rcpState === 0
  const readyText = ready ? '준비됨' : (s.rcpState === 1 ? '제조중' : '대기중')
  const readyClass = 'status-chip ' + (ready ? 'ok' : s.rcpState === 1 ? 'warn' : '')

  dom.id('chip-temp').textContent     = tempText
  dom.id('chip-temp').className       = tempClass
  dom.id('chip-pressure').textContent = pressText
  dom.id('chip-cup').textContent      = cupText
  dom.id('chip-cup').className        = cupClass
  dom.id('chip-ready').textContent    = readyText
  dom.id('chip-ready').className      = readyClass

  dom.id('brew-chip-temp').textContent     = tempText
  dom.id('brew-chip-temp').className       = tempClass
  dom.id('brew-chip-pressure').textContent = pressText
  dom.id('brew-chip-cup').textContent      = cupText
  dom.id('brew-chip-cup').className        = cupClass

  // 카드 클릭 가능 여부 (준비됨 상태일 때만)
  document.querySelectorAll('.recipe-card[data-recipe]').forEach(btn => {
    btn.disabled = !(state.connected && ready)
    btn.style.opacity = (state.connected && ready) ? '1' : '0.4'
    btn.style.cursor  = (state.connected && ready) ? 'pointer' : 'not-allowed'
  })

  updateStageTrack(s)

  const wasBrewing = state.prevRcpState === 1
  const isBrewing  = s.rcpState === 1

  // 제조 시작 감지: 메뉴 화면이면 제조 화면으로 전환
  if (!wasBrewing && isBrewing && state.queue.length > 0) {
    const active = document.querySelector('.screen.active')?.id
    if (active === 'screen-menu') {
      dom.id('brewing-recipe-name').textContent = state.queue[0]?.name ?? ''
      showScreen('brewing')
    }
    updateQueuePanel()
  }

  // 단계 1: RCP_STATE=2 (완료 신호) 감지
  if (s.rcpState === 2 && !state.brewCompleted) {
    state.brewCompleted = true
    state.currentRecipeName = state.queue[0]?.name ?? ''
    log('완료 신호 수신 (RCP_STATE=2), 컵 빠짐 대기중...')
  }

  // 단계 2: 완료 신호 후 CUP_STATUS=0 (컵 빠짐) 감지 → 최종 완료 판정
  if (state.brewCompleted && s.cup === 0) {
    state.brewCompleted = false
    const finished = state.currentRecipeName
    state.queue.shift()
    updateQueuePanel()
    updateMenuFooter()
    log('제조 완료: ' + finished + ' (컵 빠짐 확인)')

    if (state.queue.length > 0) {
      log('다음 잔 시작: ' + state.queue[0].name)
      startNextBrew()
    } else {
      showDoneScreen(finished)
    }
  }

  state.prevRcpState = s.rcpState

  dom.id('boiler-temp').textContent   = s.boiler.toFixed(2)
  dom.id('pressure').textContent      = s.pressure.toFixed(2)
  dom.id('cup-status').textContent    = s.cup
  dom.id('sys-mode').textContent      = s.sysMode
  dom.id('brw-stage').textContent     = s.stage
  dom.id('rcp-state').textContent     = s.rcpState
  dom.id('cmd-ready-val').textContent = s.cmdReady

  updateMenuFooter()
})

function updateStageTrack(s) {
  const idx        = STAGE_MAP[s.stage] ?? -1
  const bubbles    = document.querySelectorAll('.stage-bubble')
  const connectors = document.querySelectorAll('.stage-connector')

  if (s.rcpState === 2) {
    bubbles.forEach(b    => { b.classList.remove('active'); b.classList.add('done') })
    connectors.forEach(c => c.classList.add('done'))
    dom.id('brewing-stage-msg').textContent = '제조 완료!'
    dom.id('brewing-stage-msg').style.color = 'var(--green)'
  } else if (s.rcpState === 1 && idx < 0) {
    bubbles.forEach(b    => b.classList.remove('active', 'done'))
    connectors.forEach(c => c.classList.remove('done'))
    dom.id('brewing-stage-msg').textContent = '제조 시작중...'
    dom.id('brewing-stage-msg').style.color = 'var(--text-dim)'
  } else if (s.rcpState === 1 && idx >= 0) {
    bubbles.forEach((b, i) => {
      b.classList.remove('active', 'done')
      if (i < idx)        b.classList.add('done')
      else if (i === idx) b.classList.add('active')
    })
    connectors.forEach((c, i) => c.classList.toggle('done', i < idx))
    dom.id('brewing-stage-msg').textContent = STAGE_DETAIL[s.stage] ?? ''
    dom.id('brewing-stage-msg').style.color = 'var(--text)'
  } else {
    bubbles.forEach(b    => b.classList.remove('active', 'done'))
    connectors.forEach(c => c.classList.remove('done'))
    dom.id('brewing-stage-msg').textContent = '대기중'
    dom.id('brewing-stage-msg').style.color = 'var(--text-dim)'
  }

  dom.id('brewing-temp').textContent     = s.boiler.toFixed(1)
  dom.id('brewing-pressure').textContent = s.pressure.toFixed(2)
}

mcu.onLog(m => log(m))
