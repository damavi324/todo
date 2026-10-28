package com.todo.voice;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoiceReminderPlugin.class);
        registerPlugin(SpeechCapturePlugin.class);
        registerPlugin(CallSessionPlugin.class);
        super.onCreate(savedInstanceState);
        VoiceReminderHelper.ensureChannel(this);
    }

    // During a call, keep the WebView (and its call audio and live updates) running when the
    // screen locks or the app goes to the background.
    @Override
    public void onPause() {
        super.onPause();
        keepWebViewAliveDuringCall();
    }

    @Override
    public void onStop() {
        super.onStop();
        keepWebViewAliveDuringCall();
    }

    private void keepWebViewAliveDuringCall() {
        if (!CallSessionService.isRunning() || getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().onResume();
        getBridge().getWebView().resumeTimers();
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
            PluginHandle handle = getBridge().getPlugin("SocialLogin");
            if (handle == null) return;
            Plugin plugin = handle.getInstance();
            if (plugin instanceof SocialLoginPlugin) {
                ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
            }
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
