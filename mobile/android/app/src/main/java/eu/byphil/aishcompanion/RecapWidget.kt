package eu.byphil.aishcompanion

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Home-screen widget with the latest day recap. Tapping it opens the app. It shows what the app last wrote; it never starts the model itself. */
class RecapWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, views(context))
    }

    companion object {
        /** The recap as plain widget text: bullets kept, blank lines dropped. */
        fun display(recap: String): String = recap.lines().map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n")

        private fun views(context: Context): RemoteViews {
            val store = Store(context.applicationContext)
            val text = display(store.recapText)
            val v = RemoteViews(context.packageName, R.layout.widget_recap)
            v.setTextViewText(R.id.widget_text, if (text.isEmpty()) context.getString(R.string.widget_empty) else text)
            v.setTextViewText(R.id.widget_when, if (store.recapAt > 0 && text.isNotEmpty()) "Written " + relativeTime(store.recapAt) else "")
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            v.setOnClickPendingIntent(R.id.widget_root, open)
            return v
        }

        /** Redraws every placed widget; call after a new recap is stored. Does nothing when none is placed. */
        fun refresh(context: Context) {
            val app = context.applicationContext
            val manager = AppWidgetManager.getInstance(app)
            val ids = manager.getAppWidgetIds(ComponentName(app, RecapWidget::class.java))
            if (ids.isEmpty()) return
            val v = views(app)
            for (id in ids) manager.updateAppWidget(id, v)
        }
    }
}
