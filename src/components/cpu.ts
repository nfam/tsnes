import { Mapper } from './mapper';

export enum InstructionRequest {
    NORMAL = 0,
    NMI = 1,
    RESET = 2
}

export class CPU {

    private static readonly serializable = [
        'mem', 'cyclesToHalt', 'irqRequested', 'irqType',
        // Registers
        'REG_ACC', 'REG_X', 'REG_Y', 'REG_SP', 'REG_PC', 'REG_PC_NEW',
        'REG_STATUS',
        // Status
        'F_CARRY', 'F_DECIMAL', 'F_INTERRUPT', 'F_INTERRUPT_NEW', 'F_OVERFLOW',
        'F_SIGN', 'F_ZERO', 'F_NOTUSED', 'F_NOTUSED_NEW', 'F_BRK', 'F_BRK_NEW'
    ];

    get serializable(): string[] {
        return CPU.serializable;
    }

    mem: number[];
    REG_ACC: number
    REG_X: number
    REG_Y: number
    REG_SP: number
    REG_PC: number
    REG_PC_NEW: number
    REG_STATUS: number
    F_CARRY: number
    F_DECIMAL: number
    F_INTERRUPT: number
    F_INTERRUPT_NEW: number
    F_OVERFLOW: number
    F_SIGN: number
    F_ZERO: number
    F_NOTUSED: number
    F_NOTUSED_NEW: number
    F_BRK: number
    F_BRK_NEW: number
    cyclesToHalt: number
    crash: boolean
    irqRequested: boolean
    irqType: number

    constructor(public mapper: Mapper) {

        // Main memory
        this.mem = new Array(0x10000);

        for (let i = 0; i < 0x2000; i += 1) {
            this.mem[i] = 0xFF;
        }
        for (let i = 0; i < 4; i += 1) {
            var offset = i*0x800;
            this.mem[offset + 0x008] = 0xF7;
            this.mem[offset + 0x009] = 0xEF;
            this.mem[offset + 0x00A] = 0xDF;
            this.mem[offset + 0x00F] = 0xBF;
        }
        for (let i = 0x2001; i < this.mem.length; i += 1) {
            this.mem[i] = 0;
        }

        // CPU Registers:
        this.REG_ACC = 0;
        this.REG_X = 0;
        this.REG_Y = 0;
        // Reset Stack pointer:
        this.REG_SP = 0x01FF;
        // Reset Program counter:
        this.REG_PC = 0x8000-1;
        this.REG_PC_NEW = 0x8000-1;
        // Reset Status register:
        this.REG_STATUS = 0x28;

        this.setStatus(0x28);

        // Set flags:
        this.F_CARRY = 0;
        this.F_DECIMAL = 0;
        this.F_INTERRUPT = 1;
        this.F_INTERRUPT_NEW = 1;
        this.F_OVERFLOW = 0;
        this.F_SIGN = 0;
        this.F_ZERO = 1;

        this.F_NOTUSED = 1;
        this.F_NOTUSED_NEW = 1;
        this.F_BRK = 1;
        this.F_BRK_NEW = 1;

        this.cyclesToHalt = 0;

        // Reset crash flag:
        this.crash = false;

        // Interrupt notification:
        this.irqRequested = false;
        this.irqType = null;
    }

    // Emulates a single CPU instruction, returns the number of cycles
    emulate(): number {
        var temp;
        var add;

        // Check interrupts:
        if(this.irqRequested) {
            temp =
                (this.F_CARRY)|
                ((this.F_ZERO===0?1:0)<<1)|
                (this.F_INTERRUPT<<2)|
                (this.F_DECIMAL<<3)|
                (this.F_BRK<<4)|
                (this.F_NOTUSED<<5)|
                (this.F_OVERFLOW<<6)|
                (this.F_SIGN<<7);

            this.REG_PC_NEW = this.REG_PC;
            this.F_INTERRUPT_NEW = this.F_INTERRUPT;
            switch(this.irqType) {
                case 0: {
                    // Normal IRQ:
                    if(this.F_INTERRUPT!=0) {
                        // console.log("Interrupt was masked.");
                        break;
                    }
                    this.doIrq(temp);
                    // console.log("Did normal IRQ. I="+this.F_INTERRUPT);
                    break;
                }case 1:{
                    // NMI:
                    this.doNonMaskableInterrupt(temp);
                    break;

                }case 2:{
                    // Reset:
                    this.doResetInterrupt();
                    break;
                }
            }

            this.REG_PC = this.REG_PC_NEW;
            this.F_INTERRUPT = this.F_INTERRUPT_NEW;
            this.F_BRK = this.F_BRK_NEW;
            this.irqRequested = false;
        }

        var opinf = Operation.opdata[this.mapper.load(this.REG_PC+1)];
        var cycleCount = (opinf>>24);
        var cycleAdd = 0;

        // Find address mode:
        var addrMode = (opinf >> 8) & 0xFF;

        // Increment PC by number of op bytes:
        var opaddr = this.REG_PC;
        this.REG_PC += ((opinf >> 16) & 0xFF);

        var addr = 0;
        switch(addrMode) {
            case 0:{
                // Zero Page mode. Use the address given after the opcode,
                // but without high byte.
                addr = this.load(opaddr+2);
                break;

            }case 1:{
                // Relative mode.
                addr = this.load(opaddr+2);
                if(addr<0x80) {
                    addr += this.REG_PC;
                }
                else {
                    addr += this.REG_PC-256;
                }
                break;
            }case 2:{
                // Ignore. Address is implied in instruction.
                break;
            }case 3:{
                // Absolute mode. Use the two bytes following the opcode as
                // an address.
                addr = this.load16bit(opaddr+2);
                break;
            }case 4:{
                // Accumulator mode. The address is in the accumulator
                // register.
                addr = this.REG_ACC;
                break;
            }case 5:{
                // Immediate mode. The value is given after the opcode.
                addr = this.REG_PC;
                break;
            }case 6:{
                // Zero Page Indexed mode, X as index. Use the address given
                // after the opcode, then add the
                // X register to it to get the final address.
                addr = (this.load(opaddr+2)+this.REG_X)&0xFF;
                break;
            }case 7:{
                // Zero Page Indexed mode, Y as index. Use the address given
                // after the opcode, then add the
                // Y register to it to get the final address.
                addr = (this.load(opaddr+2)+this.REG_Y)&0xFF;
                break;
            }case 8:{
                // Absolute Indexed Mode, X as index. Same as zero page
                // indexed, but with the high byte.
                addr = this.load16bit(opaddr+2);
                if((addr&0xFF00)!=((addr+this.REG_X)&0xFF00)) {
                    cycleAdd = 1;
                }
                addr+=this.REG_X;
                break;
            }case 9:{
                // Absolute Indexed Mode, Y as index. Same as zero page
                // indexed, but with the high byte.
                addr = this.load16bit(opaddr+2);
                if((addr&0xFF00)!=((addr+this.REG_Y)&0xFF00)) {
                    cycleAdd = 1;
                }
                addr+=this.REG_Y;
                break;
            }case 10:{
                // Pre-indexed Indirect mode. Find the 16-bit address
                // starting at the given location plus
                // the current X register. The value is the contents of that
                // address.
                addr = this.load(opaddr+2);
                if((addr&0xFF00)!=((addr+this.REG_X)&0xFF00)) {
                    cycleAdd = 1;
                }
                addr+=this.REG_X;
                addr&=0xFF;
                addr = this.load16bit(addr);
                break;
            }case 11:{
                // Post-indexed Indirect mode. Find the 16-bit address
                // contained in the given location
                // (and the one following). Add to that address the contents
                // of the Y register. Fetch the value
                // stored at that adress.
                addr = this.load16bit(this.load(opaddr+2));
                if((addr&0xFF00)!=((addr+this.REG_Y)&0xFF00)) {
                    cycleAdd = 1;
                }
                addr+=this.REG_Y;
                break;
            }case 12:{
                // Indirect Absolute mode. Find the 16-bit address contained
                // at the given location.
                addr = this.load16bit(opaddr+2);// Find op
                if(addr < 0x1FFF) {
                    addr = this.mem[addr] + (this.mem[(addr & 0xFF00) | (((addr & 0xFF) + 1) & 0xFF)] << 8);// Read from address given in op
                }
                else {
                    addr = this.mapper.load(addr) + (this.mapper.load((addr & 0xFF00) | (((addr & 0xFF) + 1) & 0xFF)) << 8);
                }
                break;

            }

        }
        // Wrap around for addresses above 0xFFFF:
        addr&=0xFFFF;

        // ----------------------------------------------------------------------------------------------------
        // Decode & execute instruction:
        // ----------------------------------------------------------------------------------------------------

        // This should be compiled to a jump table.
        switch(opinf&0xFF) {
            case 0:{
                // *******
                // * ADC *
                // *******

                // Add with carry.
                temp = this.REG_ACC + this.load(addr) + this.F_CARRY;
                this.F_OVERFLOW = ((!(((this.REG_ACC ^ this.load(addr)) & 0x80)!=0) && (((this.REG_ACC ^ temp) & 0x80))!=0)?1:0);
                this.F_CARRY = (temp>255?1:0);
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp&0xFF;
                this.REG_ACC = (temp&255);
                cycleCount+=cycleAdd;
                break;

            }case 1:{
                // *******
                // * AND *
                // *******

                // AND memory with accumulator.
                this.REG_ACC = this.REG_ACC & this.load(addr);
                this.F_SIGN = (this.REG_ACC>>7)&1;
                this.F_ZERO = this.REG_ACC;
                //this.REG_ACC = temp;
                if(addrMode!=11)cycleCount+=cycleAdd; // PostIdxInd = 11
                break;
            }case 2:{
                // *******
                // * ASL *
                // *******

                // Shift left one bit
                if(addrMode == 4) { // ADDR_ACC = 4
                    this.F_CARRY = (this.REG_ACC>>7)&1;
                    this.REG_ACC = (this.REG_ACC<<1)&255;
                    this.F_SIGN = (this.REG_ACC>>7)&1;
                    this.F_ZERO = this.REG_ACC;
                }
                else {
                    temp = this.load(addr);
                    this.F_CARRY = (temp>>7)&1;
                    temp = (temp<<1)&255;
                    this.F_SIGN = (temp>>7)&1;
                    this.F_ZERO = temp;
                    this.write(addr, temp);

                }
                break;

            }case 3:{

                // *******
                // * BCC *
                // *******

                // Branch on carry clear
                if(this.F_CARRY == 0) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 4:{

                // *******
                // * BCS *
                // *******

                // Branch on carry set
                if(this.F_CARRY == 1) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 5:{

                // *******
                // * BEQ *
                // *******

                // Branch on zero
                if(this.F_ZERO == 0) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 6:{

                // *******
                // * BIT *
                // *******

                temp = this.load(addr);
                this.F_SIGN = (temp>>7)&1;
                this.F_OVERFLOW = (temp>>6)&1;
                temp &= this.REG_ACC;
                this.F_ZERO = temp;
                break;

            }case 7:{

                // *******
                // * BMI *
                // *******

                // Branch on negative result
                if(this.F_SIGN == 1) {
                    cycleCount++;
                    this.REG_PC = addr;
                }
                break;

            }case 8:{

                // *******
                // * BNE *
                // *******

                // Branch on not zero
                if(this.F_ZERO != 0) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 9:{

                // *******
                // * BPL *
                // *******

                // Branch on positive result
                if(this.F_SIGN == 0) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 10:{

                // *******
                // * BRK *
                // *******

                this.REG_PC+=2;
                this.push((this.REG_PC>>8)&255);
                this.push(this.REG_PC&255);
                this.F_BRK = 1;

                this.push(
                    (this.F_CARRY)|
                    ((this.F_ZERO==0?1:0)<<1)|
                    (this.F_INTERRUPT<<2)|
                    (this.F_DECIMAL<<3)|
                    (this.F_BRK<<4)|
                    (this.F_NOTUSED<<5)|
                    (this.F_OVERFLOW<<6)|
                    (this.F_SIGN<<7)
                );

                this.F_INTERRUPT = 1;
                //this.REG_PC = load(0xFFFE) | (load(0xFFFF) << 8);
                this.REG_PC = this.load16bit(0xFFFE);
                this.REG_PC--;
                break;

            }case 11:{

                // *******
                // * BVC *
                // *******

                // Branch on overflow clear
                if(this.F_OVERFLOW == 0) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 12:{

                // *******
                // * BVS *
                // *******

                // Branch on overflow set
                if(this.F_OVERFLOW == 1) {
                    cycleCount += ((opaddr&0xFF00)!=(addr&0xFF00)?2:1);
                    this.REG_PC = addr;
                }
                break;

            }case 13:{

                // *******
                // * CLC *
                // *******

                // Clear carry flag
                this.F_CARRY = 0;
                break;

            }case 14:{

                // *******
                // * CLD *
                // *******

                // Clear decimal flag
                this.F_DECIMAL = 0;
                break;

            }case 15:{

                // *******
                // * CLI *
                // *******

                // Clear interrupt flag
                this.F_INTERRUPT = 0;
                break;

            }case 16:{

                // *******
                // * CLV *
                // *******

                // Clear overflow flag
                this.F_OVERFLOW = 0;
                break;

            }case 17:{

                // *******
                // * CMP *
                // *******

                // Compare memory and accumulator:
                temp = this.REG_ACC - this.load(addr);
                this.F_CARRY = (temp>=0?1:0);
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp&0xFF;
                cycleCount+=cycleAdd;
                break;

            }case 18:{

                // *******
                // * CPX *
                // *******

                // Compare memory and index X:
                temp = this.REG_X - this.load(addr);
                this.F_CARRY = (temp>=0?1:0);
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp&0xFF;
                break;

            }case 19:{

                // *******
                // * CPY *
                // *******

                // Compare memory and index Y:
                temp = this.REG_Y - this.load(addr);
                this.F_CARRY = (temp>=0?1:0);
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp&0xFF;
                break;

            }case 20:{

                // *******
                // * DEC *
                // *******

                // Decrement memory by one:
                temp = (this.load(addr)-1)&0xFF;
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp;
                this.write(addr, temp);
                break;

            }case 21:{

                // *******
                // * DEX *
                // *******

                // Decrement index X by one:
                this.REG_X = (this.REG_X-1)&0xFF;
                this.F_SIGN = (this.REG_X>>7)&1;
                this.F_ZERO = this.REG_X;
                break;

            }case 22:{

                // *******
                // * DEY *
                // *******

                // Decrement index Y by one:
                this.REG_Y = (this.REG_Y-1)&0xFF;
                this.F_SIGN = (this.REG_Y>>7)&1;
                this.F_ZERO = this.REG_Y;
                break;

            }case 23:{

                // *******
                // * EOR *
                // *******

                // XOR Memory with accumulator, store in accumulator:
                this.REG_ACC = (this.load(addr)^this.REG_ACC)&0xFF;
                this.F_SIGN = (this.REG_ACC>>7)&1;
                this.F_ZERO = this.REG_ACC;
                cycleCount+=cycleAdd;
                break;

            }case 24:{

                // *******
                // * INC *
                // *******

                // Increment memory by one:
                temp = (this.load(addr)+1)&0xFF;
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp;
                this.write(addr, temp&0xFF);
                break;

            }case 25:{

                // *******
                // * INX *
                // *******

                // Increment index X by one:
                this.REG_X = (this.REG_X+1)&0xFF;
                this.F_SIGN = (this.REG_X>>7)&1;
                this.F_ZERO = this.REG_X;
                break;

            }case 26:{

                // *******
                // * INY *
                // *******

                // Increment index Y by one:
                this.REG_Y++;
                this.REG_Y &= 0xFF;
                this.F_SIGN = (this.REG_Y>>7)&1;
                this.F_ZERO = this.REG_Y;
                break;

            }case 27:{

                // *******
                // * JMP *
                // *******

                // Jump to new location:
                this.REG_PC = addr-1;
                break;

            }case 28:{

                // *******
                // * JSR *
                // *******

                // Jump to new location, saving return address.
                // Push return address on stack:
                this.push((this.REG_PC>>8)&255);
                this.push(this.REG_PC&255);
                this.REG_PC = addr-1;
                break;

            }case 29:{

                // *******
                // * LDA *
                // *******

                // Load accumulator with memory:
                this.REG_ACC = this.load(addr);
                this.F_SIGN = (this.REG_ACC>>7)&1;
                this.F_ZERO = this.REG_ACC;
                cycleCount+=cycleAdd;
                break;

            }case 30:{

                // *******
                // * LDX *
                // *******

                // Load index X with memory:
                this.REG_X = this.load(addr);
                this.F_SIGN = (this.REG_X>>7)&1;
                this.F_ZERO = this.REG_X;
                cycleCount+=cycleAdd;
                break;

            }case 31:{

                // *******
                // * LDY *
                // *******

                // Load index Y with memory:
                this.REG_Y = this.load(addr);
                this.F_SIGN = (this.REG_Y>>7)&1;
                this.F_ZERO = this.REG_Y;
                cycleCount+=cycleAdd;
                break;

            }case 32:{

                // *******
                // * LSR *
                // *******

                // Shift right one bit:
                if(addrMode == 4) { // ADDR_ACC
                    temp = (this.REG_ACC & 0xFF);
                    this.F_CARRY = temp&1;
                    temp >>= 1;
                    this.REG_ACC = temp;
                }
                else {
                    temp = this.load(addr) & 0xFF;
                    this.F_CARRY = temp&1;
                    temp >>= 1;
                    this.write(addr, temp);
                }
                this.F_SIGN = 0;
                this.F_ZERO = temp;
                break;

            }case 33:{

                // *******
                // * NOP *
                // *******

                // No OPeration.
                // Ignore.
                break;

            }case 34:{

                // *******
                // * ORA *
                // *******

                // OR memory with accumulator, store in accumulator.
                temp = (this.load(addr)|this.REG_ACC)&255;
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp;
                this.REG_ACC = temp;
                if(addrMode!=11)cycleCount+=cycleAdd; // PostIdxInd = 11
                break;

            }case 35:{

                // *******
                // * PHA *
                // *******

                // Push accumulator on stack
                this.push(this.REG_ACC);
                break;

            }case 36:{

                // *******
                // * PHP *
                // *******

                // Push processor status on stack
                this.F_BRK = 1;
                this.push(
                    (this.F_CARRY)|
                    ((this.F_ZERO==0?1:0)<<1)|
                    (this.F_INTERRUPT<<2)|
                    (this.F_DECIMAL<<3)|
                    (this.F_BRK<<4)|
                    (this.F_NOTUSED<<5)|
                    (this.F_OVERFLOW<<6)|
                    (this.F_SIGN<<7)
                );
                break;

            }case 37:{

                // *******
                // * PLA *
                // *******

                // Pull accumulator from stack
                this.REG_ACC = this.pull();
                this.F_SIGN = (this.REG_ACC>>7)&1;
                this.F_ZERO = this.REG_ACC;
                break;

            }case 38:{

                // *******
                // * PLP *
                // *******

                // Pull processor status from stack
                temp = this.pull();
                this.F_CARRY     = (temp   )&1;
                this.F_ZERO      = (((temp>>1)&1)==1)?0:1;
                this.F_INTERRUPT = (temp>>2)&1;
                this.F_DECIMAL   = (temp>>3)&1;
                this.F_BRK       = (temp>>4)&1;
                this.F_NOTUSED   = (temp>>5)&1;
                this.F_OVERFLOW  = (temp>>6)&1;
                this.F_SIGN      = (temp>>7)&1;

                this.F_NOTUSED = 1;
                break;

            }case 39:{

                // *******
                // * ROL *
                // *******

                // Rotate one bit left
                if (addrMode == 4) { // ADDR_ACC = 4
                    temp = this.REG_ACC;
                    add = this.F_CARRY;
                    this.F_CARRY = (temp>>7)&1;
                    temp = ((temp<<1)&0xFF)+add;
                    this.REG_ACC = temp;
                }
                else {
                    temp = this.load(addr);
                    add = this.F_CARRY;
                    this.F_CARRY = (temp>>7)&1;
                    temp = ((temp<<1)&0xFF)+add;
                    this.write(addr, temp);

                }
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp;
                break;

            }case 40:{

                // *******
                // * ROR *
                // *******

                // Rotate one bit right
                if(addrMode == 4) { // ADDR_ACC = 4
                    add = this.F_CARRY<<7;
                    this.F_CARRY = this.REG_ACC&1;
                    temp = (this.REG_ACC>>1)+add;
                    this.REG_ACC = temp;
                }
                else {
                    temp = this.load(addr);
                    add = this.F_CARRY<<7;
                    this.F_CARRY = temp&1;
                    temp = (temp>>1)+add;
                    this.write(addr, temp);
                }
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp;
                break;

            }case 41:{

                // *******
                // * RTI *
                // *******

                // Return from interrupt. Pull status and PC from stack.

                temp = this.pull();
                this.F_CARRY     = (temp   )&1;
                this.F_ZERO      = ((temp>>1)&1)==0?1:0;
                this.F_INTERRUPT = (temp>>2)&1;
                this.F_DECIMAL   = (temp>>3)&1;
                this.F_BRK       = (temp>>4)&1;
                this.F_NOTUSED   = (temp>>5)&1;
                this.F_OVERFLOW  = (temp>>6)&1;
                this.F_SIGN      = (temp>>7)&1;

                this.REG_PC = this.pull();
                this.REG_PC += (this.pull()<<8);
                if(this.REG_PC==0xFFFF) {
                    return;
                }
                this.REG_PC--;
                this.F_NOTUSED = 1;
                break;

            }case 42:{

                // *******
                // * RTS *
                // *******

                // Return from subroutine. Pull PC from stack.

                this.REG_PC = this.pull();
                this.REG_PC += (this.pull()<<8);

                if(this.REG_PC==0xFFFF) {
                    return; // return from NSF play routine:
                }
                break;

            }case 43:{

                // *******
                // * SBC *
                // *******

                temp = this.REG_ACC-this.load(addr)-(1-this.F_CARRY);
                this.F_SIGN = (temp>>7)&1;
                this.F_ZERO = temp&0xFF;
                this.F_OVERFLOW = ((((this.REG_ACC^temp)&0x80)!=0 && ((this.REG_ACC^this.load(addr))&0x80)!=0)?1:0);
                this.F_CARRY = (temp<0?0:1);
                this.REG_ACC = (temp&0xFF);
                if(addrMode!=11)cycleCount+=cycleAdd; // PostIdxInd = 11
                break;

            }case 44:{

                // *******
                // * SEC *
                // *******

                // Set carry flag
                this.F_CARRY = 1;
                break;

            }case 45:{

                // *******
                // * SED *
                // *******

                // Set decimal mode
                this.F_DECIMAL = 1;
                break;

            }case 46:{

                // *******
                // * SEI *
                // *******

                // Set interrupt disable status
                this.F_INTERRUPT = 1;
                break;

            }case 47:{

                // *******
                // * STA *
                // *******

                // Store accumulator in memory
                this.write(addr, this.REG_ACC);
                break;

            }case 48:{

                // *******
                // * STX *
                // *******

                // Store index X in memory
                this.write(addr, this.REG_X);
                break;

            }case 49:{

                // *******
                // * STY *
                // *******

                // Store index Y in memory:
                this.write(addr, this.REG_Y);
                break;

            }case 50:{

                // *******
                // * TAX *
                // *******

                // Transfer accumulator to index X:
                this.REG_X = this.REG_ACC;
                this.F_SIGN = (this.REG_ACC>>7)&1;
                this.F_ZERO = this.REG_ACC;
                break;

            }case 51:{

                // *******
                // * TAY *
                // *******

                // Transfer accumulator to index Y:
                this.REG_Y = this.REG_ACC;
                this.F_SIGN = (this.REG_ACC>>7)&1;
                this.F_ZERO = this.REG_ACC;
                break;

            }case 52:{

                // *******
                // * TSX *
                // *******

                // Transfer stack pointer to index X:
                this.REG_X = (this.REG_SP-0x0100);
                this.F_SIGN = (this.REG_SP>>7)&1;
                this.F_ZERO = this.REG_X;
                break;

            }case 53:{

                // *******
                // * TXA *
                // *******

                // Transfer index X to accumulator:
                this.REG_ACC = this.REG_X;
                this.F_SIGN = (this.REG_X>>7)&1;
                this.F_ZERO = this.REG_X;
                break;

            }case 54:{

                // *******
                // * TXS *
                // *******

                // Transfer index X to stack pointer:
                this.REG_SP = (this.REG_X+0x0100);
                this.stackWrap();
                break;

            }case 55:{

                // *******
                // * TYA *
                // *******

                // Transfer index Y to accumulator:
                this.REG_ACC = this.REG_Y;
                this.F_SIGN = (this.REG_Y>>7)&1;
                this.F_ZERO = this.REG_Y;
                break;

            }default:{

                // *******
                // * ??? *
                // *******
                throw new Error('Game crashed, invalid opcode at address $'+opaddr.toString(16));
            }

        }// end of switch

        return cycleCount;

    }

    load(addr: number): number {
        if (addr < 0x2000) {
            return this.mem[addr & 0x7FF];
        }
        else {
            return this.mapper.load(addr);
        }
    }

    load16bit(addr: number): number {
        if (addr < 0x1FFF) {
            return this.mem[addr&0x7FF] | (this.mem[(addr+1)&0x7FF]<<8);
        }
        else {
            return this.mapper.load(addr) | (this.mapper.load(addr+1) << 8);
        }
    }

    write(addr: number, val: number): void {
        if(addr < 0x2000) {
            this.mem[addr&0x7FF] = val;
        }
        else {
            this.mapper.write(addr,val);
        }
    }

    requestIrq(type: InstructionRequest): void {
        if(this.irqRequested) {
            if(type == InstructionRequest.NORMAL) {
                return;
            }
            // console.log("too fast irqs. type="+type);
        }
        this.irqRequested = true;
        this.irqType = type;
    }

    push(value: number): void {
        this.mapper.write(this.REG_SP, value);
        this.REG_SP--;
        this.REG_SP = 0x0100 | (this.REG_SP&0xFF);
    }

    stackWrap(): void {
        this.REG_SP = 0x0100 | (this.REG_SP&0xFF);
    }

    pull(): number {
        this.REG_SP++;
        this.REG_SP = 0x0100 | (this.REG_SP&0xFF);
        return this.mapper.load(this.REG_SP);
    }

    pageCrossed(addr1: number, addr2: number): boolean {
        return ((addr1&0xFF00) != (addr2&0xFF00));
    }

    haltCycles(cycles: number): void {
        this.cyclesToHalt += cycles;
    }

    doNonMaskableInterrupt(status: number): void {
        if((this.mapper.load(0x2000) & 128) != 0) { // Check whether VBlank Interrupts are enabled
            this.REG_PC_NEW++;
            this.push((this.REG_PC_NEW>>8)&0xFF);
            this.push(this.REG_PC_NEW&0xFF);
            //this.F_INTERRUPT_NEW = 1;
            this.push(status);

            this.REG_PC_NEW = this.mapper.load(0xFFFA) | (this.mapper.load(0xFFFB) << 8);
            this.REG_PC_NEW--;
        }
    }

    doResetInterrupt(): void {
        this.REG_PC_NEW = this.mapper.load(0xFFFC) | (this.mapper.load(0xFFFD) << 8);
        this.REG_PC_NEW--;
    }

    doIrq(status: number): void {
        this.REG_PC_NEW++;
        this.push((this.REG_PC_NEW>>8)&0xFF);
        this.push(this.REG_PC_NEW&0xFF);
        this.push(status);
        this.F_INTERRUPT_NEW = 1;
        this.F_BRK_NEW = 0;

        this.REG_PC_NEW = this.mapper.load(0xFFFE) | (this.mapper.load(0xFFFF) << 8);
        this.REG_PC_NEW--;
    }

    getStatus(): number {
        return (this.F_CARRY)
                |(this.F_ZERO<<1)
                |(this.F_INTERRUPT<<2)
                |(this.F_DECIMAL<<3)
                |(this.F_BRK<<4)
                |(this.F_NOTUSED<<5)
                |(this.F_OVERFLOW<<6)
                |(this.F_SIGN<<7);
    }

    setStatus(st: number): void {
        this.F_CARRY     = (st   )&1;
        this.F_ZERO      = (st>>1)&1;
        this.F_INTERRUPT = (st>>2)&1;
        this.F_DECIMAL   = (st>>3)&1;
        this.F_BRK       = (st>>4)&1;
        this.F_NOTUSED   = (st>>5)&1;
        this.F_OVERFLOW  = (st>>6)&1;
        this.F_SIGN      = (st>>7)&1;
    }
}

// Generates and provides an array of details about instructions
namespace Operation {
    enum Instruction {
        ADC = 0,
        AND = 1,
        ASL = 2,

        BCC = 3,
        BCS = 4,
        BEQ = 5,
        BIT = 6,
        BMI = 7,
        BNE = 8,
        BPL = 9,
        BRK = 10,
        BVC = 11,
        BVS = 12,

        CLC = 13,
        CLD = 14,
        CLI = 15,
        CLV = 16,
        CMP = 17,
        CPX = 18,
        CPY = 19,

        DEC = 20,
        DEX = 21,
        DEY = 22,

        EOR = 23,

        INC = 24,
        INX = 25,
        INY = 26,

        JMP = 27,
        JSR = 28,

        LDA = 29,
        LDX = 30,
        LDY = 31,
        LSR = 32,

        NOP = 33,

        ORA = 34,

        PHA = 35,
        PHP = 36,
        PLA = 37,
        PLP = 38,

        ROL = 39,
        ROR = 40,
        RTI = 41,
        RTS = 42,

        SBC = 43,
        SEC = 44,
        SED = 45,
        SEI = 46,
        STA = 47,
        STX = 48,
        STY = 49,

        TAX = 50,
        TAY = 51,
        TSX = 52,
        TXA = 53,
        TXS = 54,
        TYA = 55,

        DUMMY = 56, // dummy instruction used for 'halting' the processor some cycles
    }

    enum Address {
        ZP         = 0,
        REL        = 1,
        IMP        = 2,
        ABS        = 3,
        ACC        = 4,
        IMM        = 5,
        ZPX        = 6,
        ZPY        = 7,
        ABSX       = 8,
        ABSY       = 9,
        PREIDXIND  = 10,
        POSTIDXIND = 11,
        INDABS     = 12
    }

    var cycTable = [
        /*0x00*/ 7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6,
        /*0x10*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
        /*0x20*/ 6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6,
        /*0x30*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
        /*0x40*/ 6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6,
        /*0x50*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
        /*0x60*/ 6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6,
        /*0x70*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
        /*0x80*/ 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
        /*0x90*/ 2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
        /*0xA0*/ 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
        /*0xB0*/ 2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
        /*0xC0*/ 2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
        /*0xD0*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
        /*0xE0*/ 2,6,3,8,3,3,5,5,2,2,2,2,4,4,6,6,
        /*0xF0*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7
    ];

    export var opdata = new Array(256);

    function setOp(inst: Instruction, op: number, addr: number, size: number, cycles: number) {
        opdata[op] =
            ((inst  &0xFF)    )|
            ((addr  &0xFF)<< 8)|
            ((size  &0xFF)<<16)|
            ((cycles&0xFF)<<24);
    }

    // Set all to invalid instruction (to detect crashes):
    for(let i = 0; i < 256; i++) opdata[i] = 0xFF;

    // Now fill in all valid opcodes:

    // ADC:
    setOp(Instruction.ADC,0x69,Address.IMM,2,2);
    setOp(Instruction.ADC,0x65,Address.ZP,2,3);
    setOp(Instruction.ADC,0x75,Address.ZPX,2,4);
    setOp(Instruction.ADC,0x6D,Address.ABS,3,4);
    setOp(Instruction.ADC,0x7D,Address.ABSX,3,4);
    setOp(Instruction.ADC,0x79,Address.ABSY,3,4);
    setOp(Instruction.ADC,0x61,Address.PREIDXIND,2,6);
    setOp(Instruction.ADC,0x71,Address.POSTIDXIND,2,5);

    // AND:
    setOp(Instruction.AND,0x29,Address.IMM,2,2);
    setOp(Instruction.AND,0x25,Address.ZP,2,3);
    setOp(Instruction.AND,0x35,Address.ZPX,2,4);
    setOp(Instruction.AND,0x2D,Address.ABS,3,4);
    setOp(Instruction.AND,0x3D,Address.ABSX,3,4);
    setOp(Instruction.AND,0x39,Address.ABSY,3,4);
    setOp(Instruction.AND,0x21,Address.PREIDXIND,2,6);
    setOp(Instruction.AND,0x31,Address.POSTIDXIND,2,5);

    // ASL:
    setOp(Instruction.ASL,0x0A,Address.ACC,1,2);
    setOp(Instruction.ASL,0x06,Address.ZP,2,5);
    setOp(Instruction.ASL,0x16,Address.ZPX,2,6);
    setOp(Instruction.ASL,0x0E,Address.ABS,3,6);
    setOp(Instruction.ASL,0x1E,Address.ABSX,3,7);

    // BCC:
    setOp(Instruction.BCC,0x90,Address.REL,2,2);

    // BCS:
    setOp(Instruction.BCS,0xB0,Address.REL,2,2);

    // BEQ:
    setOp(Instruction.BEQ,0xF0,Address.REL,2,2);

    // BIT:
    setOp(Instruction.BIT,0x24,Address.ZP,2,3);
    setOp(Instruction.BIT,0x2C,Address.ABS,3,4);

    // BMI:
    setOp(Instruction.BMI,0x30,Address.REL,2,2);

    // BNE:
    setOp(Instruction.BNE,0xD0,Address.REL,2,2);

    // BPL:
    setOp(Instruction.BPL,0x10,Address.REL,2,2);

    // BRK:
    setOp(Instruction.BRK,0x00,Address.IMP,1,7);

    // BVC:
    setOp(Instruction.BVC,0x50,Address.REL,2,2);

    // BVS:
    setOp(Instruction.BVS,0x70,Address.REL,2,2);

    // CLC:
    setOp(Instruction.CLC,0x18,Address.IMP,1,2);

    // CLD:
    setOp(Instruction.CLD,0xD8,Address.IMP,1,2);

    // CLI:
    setOp(Instruction.CLI,0x58,Address.IMP,1,2);

    // CLV:
    setOp(Instruction.CLV,0xB8,Address.IMP,1,2);

    // CMP:
    setOp(Instruction.CMP,0xC9,Address.IMM,2,2);
    setOp(Instruction.CMP,0xC5,Address.ZP,2,3);
    setOp(Instruction.CMP,0xD5,Address.ZPX,2,4);
    setOp(Instruction.CMP,0xCD,Address.ABS,3,4);
    setOp(Instruction.CMP,0xDD,Address.ABSX,3,4);
    setOp(Instruction.CMP,0xD9,Address.ABSY,3,4);
    setOp(Instruction.CMP,0xC1,Address.PREIDXIND,2,6);
    setOp(Instruction.CMP,0xD1,Address.POSTIDXIND,2,5);

    // CPX:
    setOp(Instruction.CPX,0xE0,Address.IMM,2,2);
    setOp(Instruction.CPX,0xE4,Address.ZP,2,3);
    setOp(Instruction.CPX,0xEC,Address.ABS,3,4);

    // CPY:
    setOp(Instruction.CPY,0xC0,Address.IMM,2,2);
    setOp(Instruction.CPY,0xC4,Address.ZP,2,3);
    setOp(Instruction.CPY,0xCC,Address.ABS,3,4);

    // DEC:
    setOp(Instruction.DEC,0xC6,Address.ZP,2,5);
    setOp(Instruction.DEC,0xD6,Address.ZPX,2,6);
    setOp(Instruction.DEC,0xCE,Address.ABS,3,6);
    setOp(Instruction.DEC,0xDE,Address.ABSX,3,7);

    // DEX:
    setOp(Instruction.DEX,0xCA,Address.IMP,1,2);

    // DEY:
    setOp(Instruction.DEY,0x88,Address.IMP,1,2);

    // EOR:
    setOp(Instruction.EOR,0x49,Address.IMM,2,2);
    setOp(Instruction.EOR,0x45,Address.ZP,2,3);
    setOp(Instruction.EOR,0x55,Address.ZPX,2,4);
    setOp(Instruction.EOR,0x4D,Address.ABS,3,4);
    setOp(Instruction.EOR,0x5D,Address.ABSX,3,4);
    setOp(Instruction.EOR,0x59,Address.ABSY,3,4);
    setOp(Instruction.EOR,0x41,Address.PREIDXIND,2,6);
    setOp(Instruction.EOR,0x51,Address.POSTIDXIND,2,5);

    // INC:
    setOp(Instruction.INC,0xE6,Address.ZP,2,5);
    setOp(Instruction.INC,0xF6,Address.ZPX,2,6);
    setOp(Instruction.INC,0xEE,Address.ABS,3,6);
    setOp(Instruction.INC,0xFE,Address.ABSX,3,7);

    // INX:
    setOp(Instruction.INX,0xE8,Address.IMP,1,2);

    // INY:
    setOp(Instruction.INY,0xC8,Address.IMP,1,2);

    // JMP:
    setOp(Instruction.JMP,0x4C,Address.ABS,3,3);
    setOp(Instruction.JMP,0x6C,Address.INDABS,3,5);

    // JSR:
    setOp(Instruction.JSR,0x20,Address.ABS,3,6);

    // LDA:
    setOp(Instruction.LDA,0xA9,Address.IMM,2,2);
    setOp(Instruction.LDA,0xA5,Address.ZP,2,3);
    setOp(Instruction.LDA,0xB5,Address.ZPX,2,4);
    setOp(Instruction.LDA,0xAD,Address.ABS,3,4);
    setOp(Instruction.LDA,0xBD,Address.ABSX,3,4);
    setOp(Instruction.LDA,0xB9,Address.ABSY,3,4);
    setOp(Instruction.LDA,0xA1,Address.PREIDXIND,2,6);
    setOp(Instruction.LDA,0xB1,Address.POSTIDXIND,2,5);


    // LDX:
    setOp(Instruction.LDX,0xA2,Address.IMM,2,2);
    setOp(Instruction.LDX,0xA6,Address.ZP,2,3);
    setOp(Instruction.LDX,0xB6,Address.ZPY,2,4);
    setOp(Instruction.LDX,0xAE,Address.ABS,3,4);
    setOp(Instruction.LDX,0xBE,Address.ABSY,3,4);

    // LDY:
    setOp(Instruction.LDY,0xA0,Address.IMM,2,2);
    setOp(Instruction.LDY,0xA4,Address.ZP,2,3);
    setOp(Instruction.LDY,0xB4,Address.ZPX,2,4);
    setOp(Instruction.LDY,0xAC,Address.ABS,3,4);
    setOp(Instruction.LDY,0xBC,Address.ABSX,3,4);

    // LSR:
    setOp(Instruction.LSR,0x4A,Address.ACC,1,2);
    setOp(Instruction.LSR,0x46,Address.ZP,2,5);
    setOp(Instruction.LSR,0x56,Address.ZPX,2,6);
    setOp(Instruction.LSR,0x4E,Address.ABS,3,6);
    setOp(Instruction.LSR,0x5E,Address.ABSX,3,7);

    // NOP:
    setOp(Instruction.NOP,0xEA,Address.IMP,1,2);

    // ORA:
    setOp(Instruction.ORA,0x09,Address.IMM,2,2);
    setOp(Instruction.ORA,0x05,Address.ZP,2,3);
    setOp(Instruction.ORA,0x15,Address.ZPX,2,4);
    setOp(Instruction.ORA,0x0D,Address.ABS,3,4);
    setOp(Instruction.ORA,0x1D,Address.ABSX,3,4);
    setOp(Instruction.ORA,0x19,Address.ABSY,3,4);
    setOp(Instruction.ORA,0x01,Address.PREIDXIND,2,6);
    setOp(Instruction.ORA,0x11,Address.POSTIDXIND,2,5);

    // PHA:
    setOp(Instruction.PHA,0x48,Address.IMP,1,3);

    // PHP:
    setOp(Instruction.PHP,0x08,Address.IMP,1,3);

    // PLA:
    setOp(Instruction.PLA,0x68,Address.IMP,1,4);

    // PLP:
    setOp(Instruction.PLP,0x28,Address.IMP,1,4);

    // ROL:
    setOp(Instruction.ROL,0x2A,Address.ACC,1,2);
    setOp(Instruction.ROL,0x26,Address.ZP,2,5);
    setOp(Instruction.ROL,0x36,Address.ZPX,2,6);
    setOp(Instruction.ROL,0x2E,Address.ABS,3,6);
    setOp(Instruction.ROL,0x3E,Address.ABSX,3,7);

    // ROR:
    setOp(Instruction.ROR,0x6A,Address.ACC,1,2);
    setOp(Instruction.ROR,0x66,Address.ZP,2,5);
    setOp(Instruction.ROR,0x76,Address.ZPX,2,6);
    setOp(Instruction.ROR,0x6E,Address.ABS,3,6);
    setOp(Instruction.ROR,0x7E,Address.ABSX,3,7);

    // RTI:
    setOp(Instruction.RTI,0x40,Address.IMP,1,6);

    // RTS:
    setOp(Instruction.RTS,0x60,Address.IMP,1,6);

    // SBC:
    setOp(Instruction.SBC,0xE9,Address.IMM,2,2);
    setOp(Instruction.SBC,0xE5,Address.ZP,2,3);
    setOp(Instruction.SBC,0xF5,Address.ZPX,2,4);
    setOp(Instruction.SBC,0xED,Address.ABS,3,4);
    setOp(Instruction.SBC,0xFD,Address.ABSX,3,4);
    setOp(Instruction.SBC,0xF9,Address.ABSY,3,4);
    setOp(Instruction.SBC,0xE1,Address.PREIDXIND,2,6);
    setOp(Instruction.SBC,0xF1,Address.POSTIDXIND,2,5);

    // SEC:
    setOp(Instruction.SEC,0x38,Address.IMP,1,2);

    // SED:
    setOp(Instruction.SED,0xF8,Address.IMP,1,2);

    // SEI:
    setOp(Instruction.SEI,0x78,Address.IMP,1,2);

    // STA:
    setOp(Instruction.STA,0x85,Address.ZP,2,3);
    setOp(Instruction.STA,0x95,Address.ZPX,2,4);
    setOp(Instruction.STA,0x8D,Address.ABS,3,4);
    setOp(Instruction.STA,0x9D,Address.ABSX,3,5);
    setOp(Instruction.STA,0x99,Address.ABSY,3,5);
    setOp(Instruction.STA,0x81,Address.PREIDXIND,2,6);
    setOp(Instruction.STA,0x91,Address.POSTIDXIND,2,6);

    // STX:
    setOp(Instruction.STX,0x86,Address.ZP,2,3);
    setOp(Instruction.STX,0x96,Address.ZPY,2,4);
    setOp(Instruction.STX,0x8E,Address.ABS,3,4);

    // STY:
    setOp(Instruction.STY,0x84,Address.ZP,2,3);
    setOp(Instruction.STY,0x94,Address.ZPX,2,4);
    setOp(Instruction.STY,0x8C,Address.ABS,3,4);

    // TAX:
    setOp(Instruction.TAX,0xAA,Address.IMP,1,2);

    // TAY:
    setOp(Instruction.TAY,0xA8,Address.IMP,1,2);

    // TSX:
    setOp(Instruction.TSX,0xBA,Address.IMP,1,2);

    // TXA:
    setOp(Instruction.TXA,0x8A,Address.IMP,1,2);

    // TXS:
    setOp(Instruction.TXS,0x9A,Address.IMP,1,2);

    // TYA:
    setOp(Instruction.TYA,0x98,Address.IMP,1,2);
}

enum Instruction {
    ADC = 0,
    AND = 1,
    ASL = 2,

    BCC = 3,
    BCS = 4,
    BEQ = 5,
    BIT = 6,
    BMI = 7,
    BNE = 8,
    BPL = 9,
    BRK = 10,
    BVC = 11,
    BVS = 12,

    CLC = 13,
    CLD = 14,
    CLI = 15,
    CLV = 16,
    CMP = 17,
    CPX = 18,
    CPY = 19,

    DEC = 20,
    DEX = 21,
    DEY = 22,

    EOR = 23,

    INC = 24,
    INX = 25,
    INY = 26,

    JMP = 27,
    JSR = 28,

    LDA = 29,
    LDX = 30,
    LDY = 31,
    LSR = 32,

    NOP = 33,

    ORA = 34,

    PHA = 35,
    PHP = 36,
    PLA = 37,
    PLP = 38,

    ROL = 39,
    ROR = 40,
    RTI = 41,
    RTS = 42,

    SBC = 43,
    SEC = 44,
    SED = 45,
    SEI = 46,
    STA = 47,
    STX = 48,
    STY = 49,

    TAX = 50,
    TAY = 51,
    TSX = 52,
    TXA = 53,
    TXS = 54,
    TYA = 55,

    DUMMY = 56, // dummy instruction used for 'halting' the processor some cycles
}

enum Address {
    ZP         = 0,
    REL        = 1,
    IMP        = 2,
    ABS        = 3,
    ACC        = 4,
    IMM        = 5,
    ZPX        = 6,
    ZPY        = 7,
    ABSX       = 8,
    ABSY       = 9,
    PREIDXIND  = 10,
    POSTIDXIND = 11,
    INDABS     = 12
}
