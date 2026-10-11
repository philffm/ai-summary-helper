package eu.byphil.aishcompanion

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity

/** Receives "Share → AISH", queues the link and disappears. No screen. */
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = intent?.getStringExtra(Intent.EXTRA_TEXT)
        val link = LinkExtractor.firstLink(text)
        when {
            Store(this).pairing == null -> {
                Toast.makeText(this, R.string.toast_not_paired, Toast.LENGTH_LONG).show()
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            link == null -> Toast.makeText(this, R.string.toast_no_link, Toast.LENGTH_SHORT).show()
            else -> {
                SendWorker.enqueue(this, link)
                Toast.makeText(this, R.string.toast_queued, Toast.LENGTH_SHORT).show()
            }
        }
        finish()
    }
}
