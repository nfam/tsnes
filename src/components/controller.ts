/* export */ export type ControllerButton =
    'a' |
    'A' |
    'b' |
    'B' |
    'select' |
    'start' |
    'u' |
    'd' |
    'l' |
    'r';

enum ControllerButtonKey {
    a,
    b,
    select,
    start,
    up,
    down,
    left,
    right
}

enum ControllerButtonState {
    down = 0x41,
    up = 0x40
}

interface ControllerButtonMap {
    key: ControllerButtonKey;
    turbo: boolean;
}

interface ControllerButtonMaps {
    a: ControllerButtonMap;
    A: ControllerButtonMap;
    b: ControllerButtonMap;
    B: ControllerButtonMap;
    select: ControllerButtonMap;
    start: ControllerButtonMap;
    u: ControllerButtonMap;
    d: ControllerButtonMap;
    l: ControllerButtonMap;
    r: ControllerButtonMap;
}

interface ControllerJoycon {
    state: ControllerButtonState[];
    turbo: { [key: number]: boolean };
    firing: { [key: number]: boolean };
}

function tickJoycon(joycon: ControllerJoycon, key: number) {
    if (joycon.turbo[key]) {
        if (joycon.firing[key]) {
            joycon.state[key] = joycon.state[key] === ControllerButtonState.down
                ? ControllerButtonState.up
                : ControllerButtonState.down;
        }
        else {
            joycon.firing[key] = true;
            joycon.state[key] = ControllerButtonState.down;
        }
    }
    else if (joycon.firing[key]) {
        joycon.firing[key] = false;
        joycon.state[key] = ControllerButtonState.up;
    }
}

export class Controller {

    private tickedOn: number = 0;

    private p1: ControllerJoycon = {
        state: [],
        turbo: {},
        firing: {}
    };

    private p2: ControllerJoycon = {
        state: [],
        turbo: {},
        firing: {}
    };

    private buttonMaps: ControllerButtonMaps = {
        a: { key: ControllerButtonKey.a, turbo: false },
        A: { key: ControllerButtonKey.a, turbo: true },
        b: { key: ControllerButtonKey.b, turbo: false },
        B: { key: ControllerButtonKey.b, turbo: true },
        select: { key: ControllerButtonKey.select, turbo: false },
        start: { key: ControllerButtonKey.start, turbo: false },
        u: { key: ControllerButtonKey.up, turbo: false },
        d: { key: ControllerButtonKey.down, turbo: false },
        l: { key: ControllerButtonKey.left, turbo: false },
        r: { key: ControllerButtonKey.right, turbo: false }
    };

    get state1(): number[] {
        return this.p1.state;
    }

    get state2(): number[] {
        return this.p2.state;
    }

    constructor() {
        for (let i = 0; i < 8; i += 1) {
            this.state1[i] = ControllerButtonState.up;
            this.state1[i] = ControllerButtonState.up;
            this.p1.turbo[i] = false;
            this.p2.firing[i] = false;
        }
    }

    public frame() {
        const now = Date.now();
        if (now - this.tickedOn > 50) {
            for (let i = 0; i < 8; i += 1) {
                tickJoycon(this.p1, i);
                tickJoycon(this.p2, i);
            }
            this.tickedOn = now;
        }
    }

    public buttonDown(player: 1|2, button: ControllerButton) {
        const m = this.buttonMaps[button];
        if (!m) {
            return;
        }

        if (player === 1) {
            if (m.turbo) {
                this.p1.turbo[m.key] = true;
            }
            else {
                this.p1.state[m.key] = ControllerButtonState.down;
            }
        }
        else if (player === 2) {
            if (m.turbo) {
                this.p2.turbo[m.key] = true;
            }
            else {
                this.p2.state[m.key] = ControllerButtonState.down;
            }
        }
    }

    public buttonUp(player: 1|2, button: ControllerButton) {
        const m = this.buttonMaps[button];
        if (!m) {
            return;
        }

        if (player === 1) {
            if (m.turbo) {
                this.p1.turbo[m.key] = false;
            }
            else {
                this.p1.state[m.key] = ControllerButtonState.up;
            }
        }
        else if (player === 2) {
            if (m.turbo) {
                this.p2.turbo[m.key] = false;
            }
            else {
                this.p2.state[m.key] = ControllerButtonState.up;
            }
        }
    }
}
