import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonOutput

def Message processData(Message message) {
    def body = message.getBody(String)

    if (body == null || body.trim().isEmpty() || body.contains('<messages/>')) {
        message.setBody("[]")
        message.setHeader("Content-Type", "application/json")
        return message
    }

    def entries = []
    try {
        def xml = new XmlSlurper().parseText(body)

        if (xml.name() == 'messages') {
            xml.message.each { msg ->
                def val = msg.text()
                if (val) {
                    try {
                        // If it's already JSON-like, we keep it as is for the join later, 
                        // but it's safer to parse and re-stringify or collect as objects
                        entries.add(new groovy.json.JsonSlurper().parseText(val))
                    } catch (e) {
                        entries.add(val)
                    }
                }
            }
        } else {
            xml.entry.each { entry ->
                def val = entry.value?.text()
                if (val) {
                    try {
                        entries.add(new groovy.json.JsonSlurper().parseText(val))
                    } catch (e) {
                        entries.add(val)
                    }
                }
            }
        }
    } catch (e) {
        // Fallback for non-XML or malformed XML
        message.setProperty("GroovyError", e.message)
    }

    // Safely produce a JSON array
    message.setBody(JsonOutput.toJson(entries))
    message.setHeader("Content-Type", "application/json")
    return message
}

