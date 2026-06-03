import com.sap.gateway.ip.core.customdev.util.Message

def Message processData(Message message) {
    def body = message.getBody(String)

    if (body == null || body.trim().isEmpty() || body.contains('<messages/>')) {
        message.setBody("[]")
        message.setHeader("Content-Type", "application/json")
        return message
    }

    def entries = []
    def xml = new groovy.util.XmlSlurper().parseText(body)

    xml.entry.each { entry ->
        def val = entry.value?.text()
        if (val) entries.add(val)
    }

    message.setBody("[" + entries.join(",") + "]")
    message.setHeader("Content-Type", "application/json")
    return message
}
