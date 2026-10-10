package com.todo.voice;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "SpeechCapture",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class SpeechCapturePlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private boolean settled;

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!hasMicPermission()) {
            requestPermissionForAlias("microphone", call, "micPermsCallback");
            return;
        }
        call.resolve(permissionStatus());
    }

    @PermissionCallback
    private void micPermsCallback(PluginCall call) {
        call.resolve(permissionStatus());
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (!hasMicPermission()) {
            requestPermissionForAlias("microphone", call, "listenAfterPermission");
            return;
        }
        startListening(call);
    }

    @PermissionCallback
    private void listenAfterPermission(PluginCall call) {
        if (hasMicPermission()) startListening(call);
        else call.reject("Microphone permission denied");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) {
                recognizer.cancel();
                recognizer.destroy();
                recognizer = null;
            }
            call.resolve();
        });
    }

    private void startListening(PluginCall call) {
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Speech recognition is not available on this phone");
            return;
        }
        getActivity().runOnUiThread(() -> {
            settled = false;
            if (recognizer != null) {
                recognizer.destroy();
            }
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {}

                @Override
                public void onBeginningOfSpeech() {}

                @Override
                public void onRmsChanged(float rmsdB) {}

                @Override
                public void onBufferReceived(byte[] buffer) {}

                @Override
                public void onEndOfSpeech() {}

                @Override
                public void onError(int error) {
                    finishReject(call, errorMessage(error));
                }

                @Override
                public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches == null || matches.isEmpty()) {
                        finishReject(call, "Didn't catch that. Try again.");
                        return;
                    }
                    JSObject data = new JSObject();
                    data.put("text", matches.get(0));
                    finishResolve(call, data);
                }

                @Override
                public void onPartialResults(Bundle partialResults) {}

                @Override
                public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            recognizer.startListening(intent);
        });
    }

    private void finishResolve(PluginCall call, JSObject data) {
        if (settled) return;
        settled = true;
        destroyRecognizer();
        call.resolve(data);
    }

    private void finishReject(PluginCall call, String message) {
        if (settled) return;
        settled = true;
        destroyRecognizer();
        call.reject(message);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    private boolean hasMicPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject permissionStatus() {
        JSObject status = new JSObject();
        status.put("microphone", hasMicPermission() ? "granted" : "denied");
        return status;
    }

    private static String errorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "Microphone audio error";
            case SpeechRecognizer.ERROR_CLIENT:
                return "Listening was cancelled";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "Microphone permission denied";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "Speech recognition needs a network connection";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "Didn't catch that. Try again.";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "Speech recognizer is busy";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "No speech heard";
            default:
                return "Speech recognition failed";
        }
    }
}
