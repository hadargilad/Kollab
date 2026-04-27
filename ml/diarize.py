import torch
import torchaudio
from pyannote.audio import Pipeline
import os

def run_diarization_only():
    YOUR_TOKEN = "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"
    audio_path = "audio_test.mp3"

    print("--- 🧠 Loading Diarization Model ---")
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=YOUR_TOKEN)
    pipeline.to(torch.device("cpu"))

    # Load the audio file
    waveform, sample_rate = torchaudio.load(audio_path)
    if sample_rate != 16000:
        # Resample audio to 16kHz if needed
        resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=16000)
        waveform = resampler(waveform)
    
    audio_in_memory = {"waveform": waveform, "sample_rate": 16000}

    print("--- ⚡ Running Diarization with Sensitivity Adjustment ---")
    
    # Here we modify parameters without fixing the number of speakers.
    # clustering_threshold: the higher the value (e.g., 0.7), the more speakers the model will merge.
    # Default is around 0.35. We try 0.8 to reduce the number of detected speakers.
    params = {
        "clustering": {
            "method": "centroid",
            "threshold": 0.8  # You can experiment with values between 0.5 and 0.8
        }
    }
    
    # Run the pipeline with the modified parameters
    output = pipeline(audio_in_memory, **params)
    diarization = output.speaker_diarization

    print("\n" + "="*50)
    print("✅ FINAL SPEAKER TIMELINE")
    print("="*50)

    unique_speakers = set()
    for segment, track, label in diarization.itertracks(yield_label=True):
        unique_speakers.add(label)
        print(f"[{segment.start:6.2f}s -> {segment.end:6.2f}s] {label}")

    print(f"\n📊 The AI detected {len(unique_speakers)} speakers with current threshold.")

if __name__ == "__main__":
    run_diarization_only()
