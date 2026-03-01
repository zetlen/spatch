// bitcrusher.js — AudioWorkletProcessor for distressed pattern effect

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 8, minValue: 1, maxValue: 16 },
      { name: 'frequencyReduction', defaultValue: 0.5, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this._lastSample = 0;
    this._phase = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input[0]) return true;

    const bitDepth =
      parameters.bitDepth.length > 1 ? parameters.bitDepth : [parameters.bitDepth[0]];
    const freqReduction =
      parameters.frequencyReduction.length > 1
        ? parameters.frequencyReduction
        : [parameters.frequencyReduction[0]];

    for (let channel = 0; channel < input.length; channel++) {
      const inp = input[channel];
      const out = output[channel];
      for (let i = 0; i < inp.length; i++) {
        const bits = bitDepth.length > 1 ? bitDepth[i] : bitDepth[0];
        const freq = freqReduction.length > 1 ? freqReduction[i] : freqReduction[0];
        const step = Math.pow(0.5, bits);

        this._phase += freq;
        if (this._phase >= 1.0) {
          this._phase -= 1.0;
          this._lastSample = step * Math.floor(inp[i] / step + 0.5);
        }
        out[i] = this._lastSample;
      }
    }
    return true;
  }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
