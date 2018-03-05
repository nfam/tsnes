export declare class Speaker {
    onbufferunderrun: (bufferSize: number, desiredSize: number) => void;
    private buffer;
    private context;
    private processor;
    close(): void;
    push(sample: number | number[]): void;
    play(samples: number[]): void;
    private onaudioprocess(event);
    private contextReady();
    private proccessorReady();
}
export declare type ControllerButton = 'a' | 'A' | 'b' | 'B' | 'select' | 'start' | 'u' | 'd' | 'l' | 'r';
export declare class Emulator {
    private system;
    private rom;
    onsample: (sample: number) => void;
    onerror: (error: Error) => void;
    load(data: ArrayBuffer): void;
    reset(): void;
    buttonDown(player: 1 | 2, button: ControllerButton): void;
    buttonUp(player: 1 | 2, button: ControllerButton): void;
    frame(): boolean;
    pull(): Output;
}
export interface Output {
    video: number[];
    audio: number[];
}
