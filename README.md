# 음료 머신 컨트롤 앱

Electron 기반 Modbus RTU 클라이언트입니다. 
MCU 시뮬레이터(machine_sim.exe)와 com0com으로 연결해 동작합니다.

## 설치

Windows에서 작업한다고 가정합니다.

1. 의존성 설치:

```bash
npm install
```

2. 시뮬레이터 준비: `machine_sim.exe`를 준비하고 com0com으로 포트 쌍(COM6<->COM7)을 설정하세요. 
`setupc.exe`는 추후 실행합니다.

3. 앱 실행:

```bash
npm start
```

4. 앱에서 포트에 연결 (예: COM7) 후 상태를 확인하고 주문을 추가하세요.

5. 사용 라이브러리

    -	electron ^42 — 크로스 플랫폼 데스크탑 앱 프레임워크
    -	serialport ^10 — Node.js 시리얼 포트 I/O
    -	@serialport/parser-inter-byte-timeout ^13 — 바이트 간 타임아웃으로 Modbus RTU 프레임 분리

6. Electron 패키징
    - npm install --save-dev electron-builder
    - package.json에 build 설정 추가 후:
    - npx electron-builder --win


