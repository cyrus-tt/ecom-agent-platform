import { InboxOutlined } from "@ant-design/icons";
import { Upload } from "antd";

export default function ToolFileUpload({ title, description, onFile, accept = ".xlsx,.xls", disabled = false }) {
  return (
    <Upload.Dragger
      className="tools-upload"
      accept={accept}
      multiple={false}
      maxCount={1}
      showUploadList={false}
      disabled={disabled}
      beforeUpload={(file) => {
        onFile(file);
        return false;
      }}
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">{title}</p>
      {description ? <p className="ant-upload-hint">{description}</p> : null}
    </Upload.Dragger>
  );
}

