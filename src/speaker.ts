/* export */ export class Speaker {
    
    public onbufferunderrun: (bufferSize: number, desiredSize: number) => void;
    private buffer: number[] = [];
    private context: AudioContext;
    private processor: ScriptProcessorNode;

    close() {
        if (this.processor) {
            this.processor.disconnect(this.context.destination);
            this.processor = null;
        }
        if (this.context) {
            this.context.close();
            this.context = null;
        }
    }

    push(sample: number|number[]) {
        if (this.proccessorReady()) {
            const samples = Array.isArray(sample) ? sample : [sample];
            for (let i = 0; i < samples.length; i += 1) {
                this.buffer.push(samples[i]);
            }
        }
    }

    play(samples: number[]) {
        if (this.contextReady()) {
            var buffer = this.context.createBuffer(1, samples.length, this.context.sampleRate);
            var channel = buffer.getChannelData(0);
            for (let i = 0; i < samples.length; i += 1) {
                channel[i] = samples[i];
            }

            var source = this.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.context.destination);
            source.start();
        }
    }

    private onaudioprocess(event: AudioProcessingEvent) {
        var chanel = event.outputBuffer.getChannelData(0);
        if (this.onbufferunderrun && this.buffer.length < chanel.length) {
            this.onbufferunderrun(this.buffer.length, chanel.length);
        }
        while (this.buffer.length > chanel.length * 2) {
            this.buffer = this.buffer.slice(chanel.length);
        }

        var size = Math.min(this.buffer.length, chanel.length);
        for (var i = 0; i < size; i++) {
            chanel[i] = this.buffer[i];
        }
        this.buffer = this.buffer.slice(size);
    }

    private contextReady(): boolean {
        if (this.context) {
            return true;
        }
        else if (window) {
            let AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (AudioContext) {
                this.context = new AudioContext();
                return true;
            }
            else {
                return false;
            }
        }
        else {
            return false;
        }
    }

    private proccessorReady(): boolean {
        if (this.processor) {
            return true;
        }
        else if (this.contextReady()) {
            this.buffer = [];
            this.processor = this.context.createScriptProcessor(1024, 1, 1);
            this.processor.onaudioprocess = this.onaudioprocess.bind(this);
            this.processor.connect(this.context.destination);
        }
        else {
            return false;
        }
    }
}
