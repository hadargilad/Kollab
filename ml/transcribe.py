import whisper
import time
import os

def run_transcription():
    # 1. Path to the audio file
    filename = "audio_test.mp3"
    
    # Check if the file exists before starting the AI engine
    if not os.path.exists(filename):
        print(f" Error: The file '{filename}' was not found.")
        return

    # 2. Load the Whisper model into memory
    # "base" is a good balance between speed and English accuracy
    print("---  Loading Whisper AI Model (Base)... ---")
    model = whisper.load_model("base")

    # 3. Start the transcription process
    print(f"---  Processing Audio: {filename} ---")
    start_time = time.time()
    
    # We specify language="en" to optimize for English
    # fp16=False is used for better compatibility with Mac/CPU
    result = model.transcribe(filename, language="en", fp16=False)
    
    end_time = time.time()
    
    # 4. Display results
    print("\n" + "="*50)
    print(" TRANSCRIPTION COMPLETE!")
    print(f" Time taken: {round(end_time - start_time, 2)} seconds")
    print("="*50)
    
    # The 'text' key contains the entire transcription as one string
    print("\n--- Full Text Detected: ---")
    print(result["text"].strip())
    
    # The 'segments' key contains timestamps for each sentence
    print("\n--- Detailed Segments (Timestamps): ---")
    for segment in result['segments'][:10]: 
        start = round(segment['start'], 2)
        end = round(segment['end'], 2)
        text = segment['text'].strip()
        print(f"[{start}s -> {end}s]: {text}")

if __name__ == "__main__":
    run_transcription()
